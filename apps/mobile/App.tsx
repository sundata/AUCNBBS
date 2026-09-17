import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { canTransition, type ListingStatus } from '@aucn/domain';
import { request, saveTokens, logout, API_URL, accessToken } from './src/api';
import { Choices, label, Publish, type EditableListing } from './src/publish';
interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
interface City {
  id: string;
  nameZh: string;
  nameEn: string;
}
interface Listing extends EditableListing {
  status: ListingStatus;
  expiresAt: string;
  owner: { id: string; displayName: string };
}
interface Row {
  id: string;
  title?: string;
  slug?: string;
  body?: string;
  status?: ListingStatus;
  expiresAt?: string;
  peer?: { displayName: string };
  unread?: number;
  senderId?: string;
  createdAt?: string;
  kind?: string;
  subjectId?: string;
  listingType?: string;
}
interface Me {
  id: string;
  displayName: string;
  role: string;
}
type Screen =
  | 'browse'
  | 'news'
  | 'community'
  | 'messages'
  | 'me'
  | 'publish'
  | 'login'
  | 'detail'
  | 'conversation'
  | 'post'
  | 'article'
  | 'search'
  | 'edit'
  | 'newPost';
export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}
function Main() {
  const [locale, setLocale] = useState<'zh' | 'en'>('zh');
  const t = useCallback((key: string) => label(locale, key), [locale]);
  const [screen, setScreen] = useState<Screen>('browse');
  const [me, setMe] = useState<Me | null>(null);
  const [cities, setCities] = useState<City[]>([]);
  const [city, setCity] = useState('');
  const [type, setType] = useState('item');
  const [rows, setRows] = useState<Row[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [detail, setDetail] = useState<Listing | null>(null);
  const [content, setContent] = useState<Row | null>(null);
  const [conversation, setConversation] = useState('');
  const [photos, setPhotos] = useState<{ id: string; token: string | null }[]>([]);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [mfaTicket, setMfaTicket] = useState('');
  const [body, setBody] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [boards, setBoards] = useState<{ slug: string; nameZh: string; nameEn: string }[]>([]);
  const [board, setBoard] = useState('');
  const [title, setTitle] = useState('');
  const fail = useCallback(
    (e: unknown) => setError(e instanceof Error ? e.message : t('common.error')),
    [t],
  );
  const run = (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    void work()
      .catch(fail)
      .finally(() => setBusy(false));
  };
  const go = (to: Screen) => {
    setError('');
    setRows([]);
    setNext(null);
    setBody('');
    setScreen(to);
    setRevision((n) => n + 1);
  };
  useEffect(() => {
    void request<City[]>('/cities', {}, false).then(setCities).catch(fail);
    void request<Me>('/me')
      .then(setMe)
      .catch(() => setMe(null));
    void request<typeof boards>('/community/boards', {}, false)
      .then((b) => {
        setBoards(b);
        setBoard(b[0]?.slug ?? '');
      })
      .catch(fail);
  }, [fail]);
  const load = useCallback(
    async (cursor?: string) => {
      let path = '';
      if (screen === 'browse') path = `/listings?type=${type}${city ? `&cityId=${city}` : ''}`;
      if (screen === 'news') path = '/articles?';
      if (screen === 'community') path = '/community/posts?';
      if (screen === 'messages') path = '/messages/conversations?';
      if (screen === 'conversation') path = `/messages/conversations/${conversation}?`;
      if (screen === 'me') path = '/listings/mine?';
      if (!path) return;
      const page = await request<Page<Row>>(
        `${path}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      setRows((old) => (cursor ? [...old, ...page.items] : page.items));
      setNext(page.nextCursor);
      if (screen === 'conversation')
        await request(`/messages/conversations/${conversation}/read`, { method: 'POST' });
    },
    [screen, type, city, conversation],
  );
  useEffect(() => {
    if (['me', 'messages', 'conversation'].includes(screen) && !me) return;
    void load().catch(fail);
  }, [load, me, revision, screen, fail]);
  useEffect(() => {
    if (screen !== 'conversation') return;
    const timer = setInterval(() => void load().catch(fail), 10000);
    return () => clearInterval(timer);
  }, [screen, load, fail]);
  const openListing = async (id: string) => {
    const listing = await request<Listing>(`/listings/${id}`);
    const images = await request<{ id: string }[]>(`/media/listings/${id}`);
    const token = await accessToken();
    setPhotos(images.map((p) => ({ ...p, token })));
    setDetail(listing);
    go('detail');
  };
  const rowCard = (row: Row) => (
    <View
      key={row.id}
      style={{
        padding: 14,
        borderWidth: 1,
        borderColor: '#ddd',
        borderRadius: 10,
        backgroundColor: 'white',
        gap: 8,
      }}
    >
      <Button
        title={row.title ?? row.peer?.displayName ?? row.body ?? row.id}
        color="#b42336"
        onPress={() =>
          run(async () => {
            if (screen === 'messages') {
              setConversation(row.id);
              go('conversation');
            } else if (screen === 'community') {
              const post = await request<Row & { comments: Row[] }>(`/community/posts/${row.id}`);
              setContent(post);
              go('post');
              setRows(post.comments);
            } else if (screen === 'news') {
              setContent(await request<Row>(`/articles/${row.slug}`));
              go('article');
            } else if (screen === 'search' && row.kind === 'article') {
              setContent(await request<Row>(`/articles/${row.slug}`));
              go('article');
            } else if (screen === 'search' && row.kind === 'post') {
              const post = await request<Row & { comments: Row[] }>(`/community/posts/${row.id}`);
              setContent(post);
              go('post');
              setRows(post.comments);
            } else await openListing(row.id);
          })
        }
      />
      {row.unread ? (
        <Text>
          {row.unread} {locale === 'zh' ? '条未读' : 'unread'}
        </Text>
      ) : null}
      {screen === 'me' && row.status && (
        <>
          <Text>{t(`listing.status.${row.status}`)}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {!['removed', 'archived', 'completed', 'pending_review'].includes(row.status) && (
              <Button
                title={t('listing.edit')}
                onPress={() =>
                  run(async () => {
                    setDetail(await request<Listing>(`/listings/${row.id}`));
                    go('edit');
                  })
                }
              />
            )}
            {(['active', 'paused', 'completed', 'archived'] as ListingStatus[])
              .filter((status) => canTransition(row.status!, status))
              .map((status) => (
                <Button
                  key={status}
                  title={t(
                    `listing.${status === 'active' ? (row.status === 'expired' ? 'renew' : 'resume') : status === 'paused' ? 'pause' : status === 'completed' ? 'markCompleted' : 'archive'}`,
                  )}
                  onPress={() =>
                    run(async () => {
                      await request(`/listings/${row.id}/status`, {
                        method: 'POST',
                        body: JSON.stringify({ status }),
                      });
                      await load();
                    })
                  }
                />
              ))}
          </View>
        </>
      )}
    </View>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 16,
          }}
        >
          <Text style={{ fontSize: 24, fontWeight: 'bold', color: '#b42336' }}>
            {locale === 'zh' ? '澳中生活圈' : 'AUCN Hub'}
          </Text>
          <Button
            title={locale === 'zh' ? 'English' : '中文'}
            onPress={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
          />
        </View>
        <ScrollView
          horizontal
          style={{ maxHeight: 50 }}
          contentContainerStyle={{ gap: 4, paddingHorizontal: 12 }}
        >
          {(['browse', 'news', 'community', 'messages', 'me', 'publish'] as Screen[]).map((s) => (
            <Button
              key={s}
              title={t(
                s === 'browse'
                  ? 'nav.market'
                  : s === 'messages'
                    ? 'messages.title'
                    : s === 'publish'
                      ? 'nav.post'
                      : s === 'me'
                        ? 'me.title'
                        : `nav.${s}`,
              )}
              onPress={() => go(s)}
            />
          ))}
        </ScrollView>
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 14 }}
          keyboardShouldPersistTaps="handled"
        >
          {busy && <ActivityIndicator />}
          {error && (
            <Text accessibilityRole="alert" style={{ color: '#b42336' }}>
              {error}
            </Text>
          )}
          {screen === 'browse' && (
            <>
              <Choices
                value={type}
                values={['housing', 'job', 'item', 'service']}
                onChange={(s) => {
                  setRows([]);
                  setType(s);
                }}
                render={(s) => t(`listing.type.${s}`)}
              />
              <Choices
                value={city}
                values={['', ...cities.map((c) => c.id)]}
                onChange={setCity}
                render={(id) =>
                  id
                    ? ((locale === 'zh'
                        ? cities.find((c) => c.id === id)?.nameZh
                        : cities.find((c) => c.id === id)?.nameEn) ?? '')
                    : t('nav.allCities')
                }
              />
              <Button title={t('nav.search')} onPress={() => go('search')} />
            </>
          )}
          {['me', 'publish', 'messages', 'edit', 'newPost'].includes(screen) && !me && (
            <Button title={t('auth.title')} onPress={() => go('login')} />
          )}
          {screen === 'me' && me && (
            <>
              <Text>{me.displayName}</Text>
              <Button
                title={t('nav.logout')}
                onPress={() =>
                  run(async () => {
                    await logout();
                    setMe(null);
                    go('browse');
                  })
                }
              />
            </>
          )}
          {screen === 'login' && (
            <>
              <Text>{t('auth.email')}</Text>
              <TextInput
                accessibilityLabel={t('auth.email')}
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
                editable={!sent}
                style={{ borderWidth: 1, borderColor: '#ccc', padding: 12 }}
              />
              {sent && (
                <TextInput
                  accessibilityLabel={mfaTicket ? t('auth.mfaCode') : t('auth.code')}
                  placeholder={mfaTicket ? t('auth.mfaCode') : t('auth.code')}
                  keyboardType="number-pad"
                  maxLength={6}
                  value={code}
                  onChangeText={setCode}
                  style={{ borderWidth: 1, borderColor: '#ccc', padding: 12 }}
                />
              )}
              <Button
                title={sent ? t('auth.verify') : t('auth.sendCode')}
                disabled={busy}
                onPress={() =>
                  run(async () => {
                    if (!sent) {
                      await request(
                        '/auth/otp/request',
                        { method: 'POST', body: JSON.stringify({ email }) },
                        false,
                      );
                      setSent(true);
                    } else if (mfaTicket) {
                      const tokens = await request<{
                        accessToken: string;
                        refreshToken: string;
                        expiresIn: number;
                      }>(
                        '/auth/mfa/complete',
                        { method: 'POST', body: JSON.stringify({ ticket: mfaTicket, code }) },
                        false,
                      );
                      await saveTokens(tokens);
                      setMe(await request<Me>('/me'));
                      setSent(false);
                      setMfaTicket('');
                      setCode('');
                      go('me');
                    } else {
                      const result = await request<{
                        accessToken?: string;
                        refreshToken?: string;
                        expiresIn?: number;
                        mfaRequired?: boolean;
                        ticket?: string;
                      }>(
                        '/auth/otp/verify',
                        { method: 'POST', body: JSON.stringify({ email, code }) },
                        false,
                      );
                      if (result.mfaRequired && result.ticket) {
                        setMfaTicket(result.ticket);
                        setCode('');
                        return;
                      }
                      if (!result.accessToken || !result.refreshToken || !result.expiresIn)
                        throw new Error('Sign-in failed');
                      await saveTokens({
                        accessToken: result.accessToken,
                        refreshToken: result.refreshToken,
                        expiresIn: result.expiresIn,
                      });
                      setMe(await request<Me>('/me'));
                      setSent(false);
                      setCode('');
                      go('me');
                    }
                  })
                }
              />
            </>
          )}
          {screen === 'search' && (
            <>
              <TextInput
                accessibilityLabel={t('nav.search')}
                value={query}
                onChangeText={setQuery}
                style={{ borderWidth: 1, borderColor: '#ddd', padding: 12 }}
              />
              <Button
                title={t('nav.search')}
                onPress={() =>
                  run(async () => {
                    const result = await request<{ hits: Row[] }>(
                      `/search?q=${encodeURIComponent(query)}`,
                    );
                    setRows(result.hits);
                  })
                }
              />
            </>
          )}
          {(screen === 'publish' || screen === 'edit') && me && (
            <Publish
              key={`${screen}-${detail?.id ?? ''}`}
              locale={locale}
              cities={cities}
              initial={screen === 'edit' ? (detail ?? undefined) : undefined}
              onDone={() => go('me')}
            />
          )}
          {screen === 'community' && (
            <Button title={t('community.newPost')} onPress={() => go('newPost')} />
          )}
          {screen === 'newPost' && me && (
            <>
              <Choices
                value={board}
                values={boards.map((b) => b.slug)}
                onChange={setBoard}
                render={(slug) => {
                  const b = boards.find((b) => b.slug === slug);
                  return locale === 'zh' ? (b?.nameZh ?? '') : (b?.nameEn ?? '');
                }}
              />
              <TextInput
                placeholder={t('post.postTitle')}
                value={title}
                onChangeText={setTitle}
                style={{ borderWidth: 1, borderColor: '#ddd', padding: 12 }}
              />
              <TextInput
                placeholder={t('post.body')}
                value={body}
                onChangeText={setBody}
                multiline
                style={{ borderWidth: 1, borderColor: '#ddd', padding: 12, minHeight: 120 }}
              />
              <Button
                title={t('post.submit')}
                onPress={() =>
                  run(async () => {
                    await request('/community/posts', {
                      method: 'POST',
                      body: JSON.stringify({
                        boardSlug: board,
                        title,
                        body,
                        type: 'discussion',
                        ...(city ? { cityId: city } : {}),
                      }),
                    });
                    go('community');
                  })
                }
              />
            </>
          )}
          {screen === 'detail' && detail && (
            <>
              <Text style={{ fontSize: 24, fontWeight: 'bold' }}>{detail.title}</Text>
              <Text>{detail.body}</Text>
              <Text>
                {detail.priceMinor == null
                  ? t('listing.priceNegotiable')
                  : `A$${(detail.priceMinor / 100).toFixed(2)}`}
              </Text>
              {photos.map((p) => (
                <Image
                  key={p.id}
                  source={{
                    uri: `${API_URL}/api/v1/media/${p.id}`,
                    headers: p.token ? { authorization: `Bearer ${p.token}` } : {},
                  }}
                  style={{ width: '100%', height: 240 }}
                />
              ))}
              {me?.id === detail.owner.id ? (
                <>
                  <Button title={t('listing.edit')} onPress={() => go('edit')} />
                  <Button
                    title={t('media.upload')}
                    onPress={() =>
                      run(async () => {
                        const result = await ImagePicker.launchImageLibraryAsync({
                          mediaTypes: ['images'],
                          quality: 0.8,
                        });
                        if (result.canceled) return;
                        const asset = result.assets[0];
                        const form = new FormData();
                        form.append('file', {
                          uri: asset.uri,
                          name: asset.fileName ?? 'photo.jpg',
                          type: asset.mimeType ?? 'image/jpeg',
                        } as unknown as Blob);
                        await request(`/media/listings/${detail.id}`, {
                          method: 'POST',
                          body: form,
                        });
                        await openListing(detail.id);
                      })
                    }
                  />
                </>
              ) : (
                <Button
                  title={t('messages.contact')}
                  onPress={() => {
                    if (!me) {
                      go('login');
                      return;
                    }
                    run(async () => {
                      const c = await request<{ id: string }>('/messages/conversations', {
                        method: 'POST',
                        body: JSON.stringify({ listingId: detail.id }),
                      });
                      setConversation(c.id);
                      go('conversation');
                    });
                  }}
                />
              )}
              <Button
                title={t('report.title')}
                onPress={() =>
                  run(async () => {
                    const receipt = await request<{ reference: string }>('/reports', {
                      method: 'POST',
                      body: JSON.stringify({
                        subjectType: 'listing',
                        subjectId: detail.id,
                        reason: 'other',
                      }),
                    });
                    setError(receipt.reference);
                  })
                }
              />
              <Text>{t('listing.safetyTip')}</Text>
            </>
          )}
          {(screen === 'article' || screen === 'post') && content && (
            <>
              <Text style={{ fontSize: 24, fontWeight: 'bold' }}>{content.title}</Text>
              <Text>{content.body}</Text>
            </>
          )}
          {screen === 'post' &&
            rows.map((r) => (
              <View key={r.id}>
                <Text>{r.body}</Text>
              </View>
            ))}
          {screen === 'conversation' &&
            [...rows].reverse().map((r) => (
              <View
                key={r.id}
                style={{
                  padding: 12,
                  backgroundColor: r.senderId === me?.id ? '#fee4e2' : '#eee',
                  borderRadius: 8,
                }}
              >
                <Text>{r.body}</Text>
              </View>
            ))}
          {(screen === 'conversation' || screen === 'post') && me && (
            <>
              <TextInput
                accessibilityLabel={t('messages.message')}
                value={body}
                onChangeText={setBody}
                multiline
                style={{ borderWidth: 1, borderColor: '#ddd', padding: 12 }}
              />
              <Button
                title={t('messages.send')}
                disabled={busy || !body.trim()}
                onPress={() =>
                  run(async () => {
                    await request(
                      screen === 'conversation'
                        ? `/messages/conversations/${conversation}`
                        : `/community/posts/${content?.id}/comments`,
                      { method: 'POST', body: JSON.stringify({ body }) },
                    );
                    setBody('');
                    if (screen === 'conversation') await load();
                    else {
                      const post = await request<{ comments: Row[] }>(
                        `/community/posts/${content?.id}`,
                      );
                      setRows(post.comments);
                    }
                  })
                }
              />
            </>
          )}
          {['browse', 'news', 'community', 'messages', 'me', 'search'].includes(screen) &&
            rows.map(rowCard)}
          {next && <Button title={t('listing.loadMore')} onPress={() => run(() => load(next))} />}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

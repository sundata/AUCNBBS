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
  slug: string;
  nameZh: string;
  nameEn: string;
}
interface PulseDash {
  metrics: { kind: string; payload: unknown }[];
  alerts: { id: string; title: string; sourceUrl: string }[];
  events: { id: string; title: string }[];
  newListings: number;
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
  subjectType?: string;
  listingType?: string;
  // business/event rows
  nameZh?: string;
  nameEn?: string;
  category?: string;
  suburb?: string;
  startsAt?: string;
  venue?: string | null;
  goingCount?: number;
  rating?: number;
  author?: { displayName: string };
  subjectMeta?: string | null;
  viewerRsvp?: string | null;
  checkinCode?: string | null;
  viewerIsOrganizer?: boolean;
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
  | 'newPost'
  | 'businesses'
  | 'business'
  | 'events'
  | 'event';
export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}
function Main() {
  const t = useCallback((key: string) => label(key), []);
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
  const [biz, setBiz] = useState<Row | null>(null);
  const [evt, setEvt] = useState<Row | null>(null);
  const [meTab, setMeTab] = useState<'listings' | 'favorites'>('listings');
  const [fav, setFav] = useState(false);
  const [lead, setLead] = useState({ name: '', contact: '', message: '' });
  const [checkin, setCheckin] = useState('');
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
      if (screen === 'me') path = meTab === 'favorites' ? '/me/favorites?' : '/listings/mine?';
      if (screen === 'businesses') path = '/businesses?';
      if (screen === 'events') path = '/events?';
      if (screen === 'business' && biz) path = `/businesses/${biz.id}/reviews?`;
      if (!path) return;
      const page = await request<Page<Row>>(
        `${path}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      setRows((old) => (cursor ? [...old, ...page.items] : page.items));
      setNext(page.nextCursor);
      if (screen === 'conversation')
        await request(`/messages/conversations/${conversation}/read`, { method: 'POST' });
    },
    [screen, type, city, conversation, meTab, biz],
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
    if (me)
      await request<{ favorited: boolean }>(`/me/favorites/listing/${id}`)
        .then((r) => setFav(r.favorited))
        .catch(() => setFav(false));
    else setFav(false);
    setDetail(listing);
    go('detail');
  };
  const openBusiness = async (id: string) => {
    setBiz(await request<Row>(`/businesses/${id}`));
    go('business');
  };
  const openEvent = async (id: string) => {
    setEvt(await request<Row>(`/events/${id}`));
    go('event');
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
        title={
          row.title ??
          row.nameZh ??
          row.peer?.displayName ??
          row.body ??
          row.id
        }
        color="#b42336"
        onPress={() =>
          run(async () => {
            if (screen === 'messages') {
              setConversation(row.id);
              go('conversation');
            } else if (screen === 'businesses') {
              await openBusiness(row.id);
            } else if (screen === 'events') {
              await openEvent(row.id);
            } else if (screen === 'me' && row.subjectId) {
              if (row.subjectType === 'event') await openEvent(row.subjectId);
              else if (row.subjectType === 'business') await openBusiness(row.subjectId);
              else if (row.subjectType === 'article' && row.subjectMeta) {
                setContent(await request<Row>(`/articles/${row.subjectMeta}`));
                go('article');
              } else await openListing(row.subjectId);
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
          {row.unread} 条未读
        </Text>
      ) : null}
      {screen === 'me' && row.subjectType && (
        <Text>
          {t(`me.favType`)}: {row.subjectType}
        </Text>
      )}
      {screen === 'events' && row.startsAt && (
        <Text>
          {new Date(row.startsAt).toLocaleString('zh-CN')}
          {row.venue ? ` · ${row.venue}` : ''}
          {row.goingCount !== undefined ? ` · ${row.goingCount}` : ''}
        </Text>
      )}
      {screen === 'businesses' && (
        <Text>
          {row.category}
          {row.suburb ? ` · ${row.suburb}` : ''}
        </Text>
      )}
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
            澳中生活圈
          </Text>
        </View>
        <ScrollView
          horizontal
          style={{ maxHeight: 50 }}
          contentContainerStyle={{ gap: 4, paddingHorizontal: 12 }}
        >
          {(
            [
              'browse',
              'news',
              'community',
              'businesses',
              'events',
              'messages',
              'me',
              'publish',
            ] as Screen[]
          ).map((s) => (
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
              <PulseCard citySlug={cities.find((c) => c.id === city)?.slug ?? ''} t={t} />
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
                  id ? (cities.find((c) => c.id === id)?.nameZh ?? '') : t('nav.allCities')
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
              <Choices
                value={meTab}
                values={['listings', 'favorites']}
                onChange={(s) => {
                  setRows([]);
                  setMeTab(s as typeof meTab);
                }}
                render={(s) => (s === 'listings' ? t('me.myListings') : t('me.favorites'))}
              />
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
                  return b?.nameZh ?? '';
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
              {me && me.id !== detail.owner.id && (
                <Button
                  title={fav ? '★ ' + t('me.favorites') : '☆ ' + t('me.favorites')}
                  onPress={() =>
                    run(async () => {
                      if (fav)
                        await request(`/me/favorites/listing/${detail.id}`, {
                          method: 'DELETE',
                        });
                      else
                        await request('/me/favorites', {
                          method: 'POST',
                          body: JSON.stringify({
                            subjectType: 'listing',
                            subjectId: detail.id,
                          }),
                        });
                      setFav(!fav);
                    })
                  }
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
          {screen === 'business' && biz && (
            <>
              <Text style={{ fontSize: 24, fontWeight: 'bold' }}>
                {biz.nameZh ?? biz.nameEn}
              </Text>
              <Text>
                {biz.category}
                {biz.suburb ? ` · ${biz.suburb}` : ''}
              </Text>
              <Text>{biz.body}</Text>
              {me && (
                <>
                  <Text>{t('businesses.contactBusiness')}</Text>
                  <TextInput
                    placeholder={t('businesses.leadName')}
                    value={lead.name}
                    onChangeText={(v) => setLead({ ...lead, name: v })}
                    style={{ borderWidth: 1, borderColor: '#ddd', padding: 12 }}
                  />
                  <TextInput
                    placeholder={t('businesses.leadContact')}
                    value={lead.contact}
                    onChangeText={(v) => setLead({ ...lead, contact: v })}
                    style={{ borderWidth: 1, borderColor: '#ddd', padding: 12 }}
                  />
                  <TextInput
                    placeholder={t('businesses.leadMessage')}
                    value={lead.message}
                    onChangeText={(v) => setLead({ ...lead, message: v })}
                    multiline
                    style={{ borderWidth: 1, borderColor: '#ddd', padding: 12, minHeight: 80 }}
                  />
                  <Button
                    title={t('businesses.send')}
                    disabled={busy}
                    onPress={() =>
                      run(async () => {
                        await request(`/businesses/${biz.id}/leads`, {
                          method: 'POST',
                          body: JSON.stringify(lead),
                        });
                        setLead({ name: '', contact: '', message: '' });
                        setError(t('businesses.leadSent'));
                      })
                    }
                  />
                </>
              )}
              {rows.map((r) => (
                <View
                  key={r.id}
                  style={{ padding: 10, borderWidth: 1, borderColor: '#eee', borderRadius: 8 }}
                >
                  <Text>
                    {'★'.repeat(r.rating ?? 0)} {r.author?.displayName}
                  </Text>
                  <Text>{r.body}</Text>
                </View>
              ))}
            </>
          )}
          {screen === 'event' && evt && (
            <>
              <Text style={{ fontSize: 24, fontWeight: 'bold' }}>{evt.title}</Text>
              <Text>
                {evt.startsAt ? new Date(evt.startsAt).toLocaleString() : ''}
                {evt.venue ? ` · ${evt.venue}` : ''}
              </Text>
              <Text>{evt.body}</Text>
              {me && (
                <Button
                  title={evt.viewerRsvp ? t('events.cancelRsvp') : t('events.rsvp')}
                  onPress={() =>
                    run(async () => {
                      if (evt.viewerRsvp)
                        await request(`/events/${evt.id}/rsvp`, { method: 'DELETE' });
                      else await request(`/events/${evt.id}/rsvp`, { method: 'POST' });
                      await openEvent(evt.id);
                    })
                  }
                />
              )}
              {evt.viewerRsvp === 'going' && evt.checkinCode && (
                <Text style={{ fontSize: 20, fontFamily: 'monospace' }}>
                  {t('events.checkinCode')}: {evt.checkinCode}
                </Text>
              )}
              {evt.viewerIsOrganizer && (
                <>
                  <TextInput
                    placeholder={t('events.checkinPlaceholder')}
                    value={checkin}
                    onChangeText={setCheckin}
                    style={{ borderWidth: 1, borderColor: '#ddd', padding: 12 }}
                  />
                  <Button
                    title={t('events.checkinSubmit')}
                    onPress={() =>
                      run(async () => {
                        const r = await request<{ user: { displayName: string } }>(
                          `/events/${evt.id}/checkin`,
                          { method: 'POST', body: JSON.stringify({ code: checkin }) },
                        );
                        setError(`${t('events.checkinOk')}: ${r.user.displayName}`);
                        setCheckin('');
                      })
                    }
                  />
                </>
              )}
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
          {[
            'browse',
            'news',
            'community',
            'messages',
            'me',
            'search',
            'businesses',
            'events',
            'business',
          ].includes(screen) && rows.map(rowCard)}
          {next && <Button title={t('listing.loadMore')} onPress={() => run(() => load(next))} />}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** "今日澳洲" strip on the browse screen: FX rate, weather, alerts, events. */
function PulseCard({ citySlug, t }: { citySlug: string; t: (k: string) => string }) {
  const [dash, setDash] = useState<PulseDash | null>(null);
  useEffect(() => {
    let active = true;
    request<PulseDash>(`/pulse/dashboard${citySlug ? `?city=${citySlug}` : ''}`)
      .then((d) => {
        if (active) setDash(d);
      })
      .catch(() => {
        if (active) setDash(null);
      });
    return () => {
      active = false;
    };
  }, [citySlug]);
  if (!dash || (!dash.metrics.length && !dash.alerts.length && !dash.events.length)) return null;
  const rate = dash.metrics.find((m) => m.kind === 'exchange_rate');
  const weather = dash.metrics.find((m) => m.kind === 'weather');
  const cny = (rate?.payload as { rates?: Record<string, number> } | undefined)?.rates?.CNY ?? null;
  const cur =
    (weather?.payload as { current?: { temp?: number; code?: number } } | undefined)?.current ??
    null;
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: '#d9e1e3',
        borderRadius: 12,
        padding: 12,
        marginBottom: 12,
        backgroundColor: '#fff',
        gap: 4,
      }}
      accessibilityLabel={t('pulse.today')}
    >
      <Text style={{ fontWeight: '600', fontSize: 16 }}>{t('pulse.today')}</Text>
      {cny != null && (
        <Text>
          {t('pulse.rate')}: 1 AUD = {cny} CNY
        </Text>
      )}
      {cur?.temp != null && (
        <Text>
          {t('pulse.weather')}: {cur.temp}°C
        </Text>
      )}
      {dash.alerts.map((a) => (
        <Text key={a.id} style={{ color: '#9e3a2b' }}>
          ⚠ {a.title}
        </Text>
      ))}
      {dash.events.length > 0 && (
        <Text style={{ color: '#55677a' }}>
          {t('pulse.upcoming')}: {dash.events.map((e) => e.title).join(' · ')}
        </Text>
      )}
    </View>
  );
}

'use client';

import {
  createListingSchema,
  createPostSchema,
  DELIVERY_METHODS,
  EMPLOYMENT_TYPES,
  HOUSING_KINDS,
  ITEM_CATEGORIES,
  ITEM_CONDITIONS,
  JOB_INDUSTRIES,
  LISTING_TYPES,
  POST_TYPES,
  PRICE_MODES,
  PROPERTY_TYPES,
  RENT_PERIODS,
  SALARY_PERIODS,
  SERVICE_CATEGORIES,
  type ListingType,
} from '@aucn/domain';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { z } from 'zod';
import { Link, useRouter, type AppLocale } from '@/i18n/routing';
import { api, ApiError, type BoardDto, type CityDto } from '@/lib/api';
import { getAccessToken, useAuth } from '@/lib/auth-client';
import { cityName, LISTING_ROUTES } from '@/lib/format';

type Kind = ListingType | 'post';
const KINDS: Kind[] = [...LISTING_TYPES, 'post'];
const CONTACT_POLICIES = ['in_app', 'phone_on_request', 'public'] as const;

function Field({
  label,
  children,
  optional,
}: {
  label: string;
  children: ReactNode;
  optional?: boolean;
}) {
  const tc = useTranslations('common');
  return (
    <label className="block text-sm">
      <span className="text-muted">
        {label}
        {optional && <span className="text-xs"> ({tc('optional')})</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

const inputCls = 'w-full rounded border border-gray-300 px-3 py-2 text-sm';

function Select<T extends string>({
  value,
  onChange,
  options,
  render,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly T[];
  render: (v: T) => string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} className={inputCls}>
      {options.map((o) => (
        <option key={o} value={o}>
          {render(o)}
        </option>
      ))}
    </select>
  );
}

const toMinor = (s: string): number | undefined =>
  s.trim() === '' ? undefined : Math.round(Number(s) * 100);
const toInt = (s: string): number | undefined => (s.trim() === '' ? undefined : Number(s));

export function PublishForm({
  cities,
  boards,
  initialType,
  initialBoard,
}: {
  cities: CityDto[];
  boards: BoardDto[];
  initialType?: string;
  initialBoard?: string;
}) {
  const t = useTranslations('post');
  const tl = useTranslations('listing');
  const th = useTranslations('housing');
  const tj = useTranslations('job');
  const ti = useTranslations('item');
  const ts = useTranslations('service');
  const tcm = useTranslations('community');
  const ta = useTranslations('auth');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const { me, loading } = useAuth();

  const [kind, setKind] = useState<Kind>(
    KINDS.includes(initialType as Kind) ? (initialType as Kind) : 'housing',
  );
  const [intent, setIntent] = useState<'offer' | 'wanted'>('offer');
  const [cityId, setCityId] = useState(cities.find((c) => c.isLaunch)?.id ?? cities[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [price, setPrice] = useState('');
  const [suburb, setSuburb] = useState('');
  const [contactPolicy, setContactPolicy] = useState<(typeof CONTACT_POLICIES)[number]>('in_app');
  // housing
  const [hKind, setHKind] = useState<(typeof HOUSING_KINDS)[number]>('share');
  const [propertyType, setPropertyType] = useState<(typeof PROPERTY_TYPES)[number]>('apartment');
  const [rentPeriod, setRentPeriod] = useState<(typeof RENT_PERIODS)[number]>('week');
  const [bedrooms, setBedrooms] = useState('1');
  const [bathrooms, setBathrooms] = useState('1');
  const [parking, setParking] = useState('0');
  const [postcode, setPostcode] = useState('');
  const [furnished, setFurnished] = useState(false);
  const [billsIncluded, setBillsIncluded] = useState(false);
  // job
  const [companyName, setCompanyName] = useState('');
  const [employmentType, setEmploymentType] =
    useState<(typeof EMPLOYMENT_TYPES)[number]>('full_time');
  const [industry, setIndustry] = useState<(typeof JOB_INDUSTRIES)[number]>('hospitality');
  const [salaryMin, setSalaryMin] = useState('');
  const [salaryMax, setSalaryMax] = useState('');
  const [salaryPeriod, setSalaryPeriod] = useState<(typeof SALARY_PERIODS)[number]>('hour');
  // item
  const [category, setCategory] = useState<(typeof ITEM_CATEGORIES)[number]>('furniture');
  const [condition, setCondition] = useState<(typeof ITEM_CONDITIONS)[number]>('good');
  const [brand, setBrand] = useState('');
  const [delivery, setDelivery] = useState<(typeof DELIVERY_METHODS)[number][]>(['pickup']);
  // service
  const [sCategory, setSCategory] = useState<(typeof SERVICE_CATEGORIES)[number]>('moving');
  const [priceMode, setPriceMode] = useState<(typeof PRICE_MODES)[number]>('quote');
  const [serviceArea, setServiceArea] = useState('');
  const [isBusiness, setIsBusiness] = useState(false);
  const [abn, setAbn] = useState('');
  // post
  const [boardSlug, setBoardSlug] = useState(
    boards.find((b) => b.slug === initialBoard)?.slug ?? boards[0]?.slug ?? '',
  );
  const [postType, setPostType] = useState<(typeof POST_TYPES)[number]>('discussion');
  const [anonymous, setAnonymous] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <p className="text-sm text-muted">{tc('loading')}</p>;
  if (!me) {
    return (
      <p className="text-sm">
        {ta('required')}{' '}
        <Link href="/login?next=/post" className="text-brand underline">
          {ta('title')}
        </Link>
      </p>
    );
  }

  function buildPayload(): unknown {
    if (kind === 'post')
      return { boardSlug, type: postType, title, body, cityId: cityId || undefined, anonymous };
    const base = {
      type: kind,
      intent,
      title,
      body,
      cityId,
      priceMinor: toMinor(price),
      contactPolicy,
    };
    switch (kind) {
      case 'housing':
        return {
          ...base,
          housing: {
            kind: hKind,
            propertyType,
            rentPeriod,
            bedrooms: toInt(bedrooms),
            bathrooms: toInt(bathrooms),
            parking: toInt(parking) ?? 0,
            furnished,
            billsIncluded,
            suburb,
            postcode: postcode || undefined,
          },
        };
      case 'job':
        return {
          ...base,
          job: {
            companyName,
            employmentType,
            industry,
            salaryMinMinor: toMinor(salaryMin),
            salaryMaxMinor: toMinor(salaryMax),
            salaryPeriod,
            remote: false,
            suburb,
          },
        };
      case 'item':
        return {
          ...base,
          item: {
            category,
            condition,
            brand: brand || undefined,
            negotiable: false,
            deliveryMethods: delivery,
            quantity: 1,
            suburb,
          },
        };
      case 'service':
        return {
          ...base,
          service: {
            category: sCategory,
            priceMode,
            serviceArea,
            isBusiness,
            abn: abn || undefined,
          },
        };
    }
  }

  async function submit() {
    setError(null);
    const payload = buildPayload();
    const parsed =
      kind === 'post'
        ? createPostSchema.safeParse(payload)
        : createListingSchema.safeParse(payload);
    if (!parsed.success) {
      const fields = Object.keys((parsed.error as z.ZodError).flatten().fieldErrors);
      setError(t('validation', { fields: fields.join(', ') || 'details' }));
      return;
    }
    setBusy(true);
    try {
      const token = await getAccessToken();
      if (kind === 'post') {
        const r = await api<{ id: string }>('/community/posts', {
          method: 'POST',
          token,
          body: JSON.stringify(parsed.data),
        });
        router.push(`/community/posts/${r.id}`);
      } else {
        const r = await api<{ id: string }>('/listings', {
          method: 'POST',
          token,
          body: JSON.stringify(parsed.data),
        });
        router.push(`/${LISTING_ROUTES[kind]}/${r.id}`);
      }
    } catch (e) {
      if (e instanceof ApiError) {
        const fields = Object.keys(e.problem.errors?.fieldErrors ?? {});
        setError(fields.length ? t('validation', { fields: fields.join(', ') }) : e.message);
      } else setError(tc('error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto bg-white rounded-lg border border-gray-200 p-6 space-y-4">
      <h1 className="text-xl font-bold">{t('title')}</h1>
      <div>
        <div className="text-sm text-muted mb-1">{t('chooseType')}</div>
        <div className="flex flex-wrap gap-2">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`px-3 py-1 rounded-full border text-sm ${kind === k ? 'bg-brand text-white border-brand' : 'border-gray-300'}`}
            >
              {k === 'post' ? tcm('newPost') : tl(`type.${k}`)}
            </button>
          ))}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-3"
      >
        {kind !== 'post' && (
          <Field label={t('intent')}>
            <div className="flex gap-2">
              {(['offer', 'wanted'] as const).map((i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIntent(i)}
                  className={`px-3 py-1 rounded border text-sm ${intent === i ? 'bg-red-50 border-brand text-brand' : 'border-gray-300'}`}
                >
                  {tl(`intentLabel.${kind}.${i}`)}
                </button>
              ))}
            </div>
          </Field>
        )}
        {kind === 'post' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('board')}>
              <Select
                value={boardSlug}
                onChange={setBoardSlug}
                options={boards.map((b) => b.slug)}
                render={(s) => {
                  const b = boards.find((x) => x.slug === s);
                  return b ? (locale === 'zh' ? b.nameZh : b.nameEn) : s;
                }}
              />
            </Field>
            <Field label={t('postType')}>
              <Select
                value={postType}
                onChange={setPostType}
                options={POST_TYPES}
                render={(v) => t(v)}
              />
            </Field>
          </div>
        )}
        <Field label={t('city')}>
          <Select
            value={cityId}
            onChange={setCityId}
            options={cities.map((c) => c.id)}
            render={(id) =>
              cityName(
                cities.find((c) => c.id === id),
                locale,
              )
            }
          />
        </Field>
        <Field label={kind === 'post' ? t('postTitle') : t('listingTitle')}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            minLength={4}
            maxLength={120}
            required
            className={inputCls}
          />
        </Field>
        <Field label={t('body')}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            minLength={10}
            maxLength={8000}
            rows={6}
            required
            className={inputCls}
          />
        </Field>

        {kind !== 'post' && kind !== 'service' && (
          <Field label={t('suburb')}>
            <input
              value={suburb}
              onChange={(e) => setSuburb(e.target.value)}
              required
              maxLength={80}
              className={inputCls}
            />
          </Field>
        )}
        {kind !== 'post' && (
          <Field label={kind === 'job' ? tj('salary') : t('price')} optional={kind !== 'job'}>
            {kind === 'job' ? (
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder={t('salaryMin')}
                  value={salaryMin}
                  onChange={(e) => setSalaryMin(e.target.value)}
                  className={inputCls}
                />
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder={t('salaryMax')}
                  value={salaryMax}
                  onChange={(e) => setSalaryMax(e.target.value)}
                  className={inputCls}
                />
                <Select
                  value={salaryPeriod}
                  onChange={setSalaryPeriod}
                  options={SALARY_PERIODS}
                  render={(v) => t(`salaryPeriods.${v}`)}
                />
              </div>
            ) : (
              <div className="flex gap-2 items-center">
                <span className="text-sm">A$</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className={inputCls}
                />
                {kind === 'housing' && (
                  <Select
                    value={rentPeriod}
                    onChange={setRentPeriod}
                    options={RENT_PERIODS}
                    render={(v) => t(`rentPeriods.${v}`)}
                  />
                )}
              </div>
            )}
            <p className="text-xs text-muted mt-1">{t('priceHint')}</p>
          </Field>
        )}

        {kind === 'housing' && (
          <fieldset className="border rounded p-3 space-y-3">
            <legend className="text-sm px-1">{t('housingFields')}</legend>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('kind')}>
                <Select
                  value={hKind}
                  onChange={setHKind}
                  options={HOUSING_KINDS}
                  render={(v) => th(`kind.${v}`)}
                />
              </Field>
              <Field label={t('propertyType')}>
                <Select
                  value={propertyType}
                  onChange={setPropertyType}
                  options={PROPERTY_TYPES}
                  render={(v) => t(`propertyTypes.${v}`)}
                />
              </Field>
              <Field label={t('bedrooms')}>
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={bedrooms}
                  onChange={(e) => setBedrooms(e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label={t('bathrooms')}>
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={bathrooms}
                  onChange={(e) => setBathrooms(e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label={t('parking')}>
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={parking}
                  onChange={(e) => setParking(e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label={t('postcode')} optional>
                <input
                  value={postcode}
                  onChange={(e) => setPostcode(e.target.value)}
                  pattern="\d{4}"
                  className={inputCls}
                />
              </Field>
            </div>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={furnished}
                  onChange={(e) => setFurnished(e.target.checked)}
                />{' '}
                {th('furnished')}
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={billsIncluded}
                  onChange={(e) => setBillsIncluded(e.target.checked)}
                />{' '}
                {th('billsIncluded')}
              </label>
            </div>
          </fieldset>
        )}
        {kind === 'job' && (
          <fieldset className="border rounded p-3 space-y-3">
            <legend className="text-sm px-1">{t('jobFields')}</legend>
            <Field label={t('companyName')}>
              <input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                required
                maxLength={120}
                className={inputCls}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('employmentType')}>
                <Select
                  value={employmentType}
                  onChange={setEmploymentType}
                  options={EMPLOYMENT_TYPES}
                  render={(v) => tj(`employmentType.${v}`)}
                />
              </Field>
              <Field label={t('industry')}>
                <Select
                  value={industry}
                  onChange={setIndustry}
                  options={JOB_INDUSTRIES}
                  render={(v) => t(`industries.${v}`)}
                />
              </Field>
            </div>
          </fieldset>
        )}
        {kind === 'item' && (
          <fieldset className="border rounded p-3 space-y-3">
            <legend className="text-sm px-1">{t('itemFields')}</legend>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('category')}>
                <Select
                  value={category}
                  onChange={setCategory}
                  options={ITEM_CATEGORIES}
                  render={(v) => t(`itemCategories.${v}`)}
                />
              </Field>
              <Field label={t('condition')}>
                <Select
                  value={condition}
                  onChange={setCondition}
                  options={ITEM_CONDITIONS}
                  render={(v) => ti(`condition.${v}`)}
                />
              </Field>
              <Field label={t('brand')} optional>
                <input
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  maxLength={80}
                  className={inputCls}
                />
              </Field>
            </div>
            <div className="text-sm">
              <span className="text-muted">{t('deliveryMethods')}</span>
              <div className="flex gap-4 mt-1">
                {DELIVERY_METHODS.map((m) => (
                  <label key={m} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={delivery.includes(m)}
                      onChange={(e) =>
                        setDelivery(
                          e.target.checked ? [...delivery, m] : delivery.filter((x) => x !== m),
                        )
                      }
                    />
                    {ti(`delivery.${m}`)}
                  </label>
                ))}
              </div>
            </div>
          </fieldset>
        )}
        {kind === 'service' && (
          <fieldset className="border rounded p-3 space-y-3">
            <legend className="text-sm px-1">{t('serviceFields')}</legend>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('category')}>
                <Select
                  value={sCategory}
                  onChange={setSCategory}
                  options={SERVICE_CATEGORIES}
                  render={(v) => t(`serviceCategories.${v}`)}
                />
              </Field>
              <Field label={t('priceMode')}>
                <Select
                  value={priceMode}
                  onChange={setPriceMode}
                  options={PRICE_MODES}
                  render={(v) => ts(`priceMode.${v}`)}
                />
              </Field>
            </div>
            <Field label={t('serviceArea')}>
              <input
                value={serviceArea}
                onChange={(e) => setServiceArea(e.target.value)}
                required
                maxLength={160}
                className={inputCls}
              />
            </Field>
            <label className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={isBusiness}
                onChange={(e) => setIsBusiness(e.target.checked)}
              />{' '}
              {t('isBusiness')}
            </label>
            {isBusiness && (
              <Field label={t('abn')} optional>
                <input
                  value={abn}
                  onChange={(e) => setAbn(e.target.value.replace(/\D/g, '').slice(0, 11))}
                  className={inputCls}
                />
              </Field>
            )}
          </fieldset>
        )}

        {kind !== 'post' ? (
          <Field label={t('contactPolicy')}>
            <Select
              value={contactPolicy}
              onChange={setContactPolicy}
              options={CONTACT_POLICIES}
              render={(v) => t(`contactPolicies.${v}`)}
            />
          </Field>
        ) : (
          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={anonymous}
              onChange={(e) => setAnonymous(e.target.checked)}
            />{' '}
            {t('anonymous')}
          </label>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-brand text-white px-5 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy ? t('submitting') : t('submit')}
        </button>
      </form>
    </div>
  );
}

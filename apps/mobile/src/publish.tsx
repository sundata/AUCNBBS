import { useState } from 'react';
import { Button, Text, TextInput, View } from 'react-native';
import {
  createListingSchema,
  HOUSING_KINDS,
  PROPERTY_TYPES,
  RENT_PERIODS,
  EMPLOYMENT_TYPES,
  JOB_INDUSTRIES,
  SALARY_PERIODS,
  ITEM_CATEGORIES,
  ITEM_CONDITIONS,
  SERVICE_CATEGORIES,
  PRICE_MODES,
  type ListingType,
} from '@aucn/domain';
import { request } from './api';
import zh from '../../web/messages/zh.json';
export function label(key: string): string {
  let current: unknown = zh;
  for (const segment of key.split('.'))
    current =
      typeof current === 'object' && current !== null
        ? (current as Record<string, unknown>)[segment]
        : undefined;
  return typeof current === 'string' ? current : key;
}
export function Choices({
  value,
  values,
  onChange,
  render,
}: {
  value: string;
  values: readonly string[];
  onChange: (s: string) => void;
  render: (s: string) => string;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {values.map((s) => (
        <Button
          key={s}
          title={`${value === s ? '✓ ' : ''}${render(s)}`}
          color={value === s ? '#b42336' : '#667085'}
          onPress={() => onChange(s)}
        />
      ))}
    </View>
  );
}
type Field = {
  key: string;
  label: string;
  choices?: readonly string[];
  prefix?: string;
  numeric?: boolean;
};
const fields: Record<ListingType, Field[]> = {
  housing: [
    { key: 'kind', label: 'post.kind', choices: HOUSING_KINDS, prefix: 'housing.kind' },
    {
      key: 'propertyType',
      label: 'post.propertyType',
      choices: PROPERTY_TYPES,
      prefix: 'post.propertyTypes',
    },
    {
      key: 'rentPeriod',
      label: 'post.rentPeriods.week',
      choices: RENT_PERIODS,
      prefix: 'post.rentPeriods',
    },
    { key: 'bedrooms', label: 'post.bedrooms', numeric: true },
    { key: 'bathrooms', label: 'post.bathrooms', numeric: true },
    { key: 'parking', label: 'post.parking', numeric: true },
    { key: 'suburb', label: 'post.suburb' },
  ],
  job: [
    { key: 'companyName', label: 'post.companyName' },
    {
      key: 'employmentType',
      label: 'post.employmentType',
      choices: EMPLOYMENT_TYPES,
      prefix: 'job.employmentType',
    },
    { key: 'industry', label: 'post.industry', choices: JOB_INDUSTRIES, prefix: 'post.industries' },
    { key: 'salaryMinMinor', label: 'post.salaryMin', numeric: true },
    { key: 'salaryMaxMinor', label: 'post.salaryMax', numeric: true },
    {
      key: 'salaryPeriod',
      label: 'job.salary',
      choices: SALARY_PERIODS,
      prefix: 'post.salaryPeriods',
    },
    { key: 'suburb', label: 'post.suburb' },
  ],
  item: [
    {
      key: 'category',
      label: 'post.category',
      choices: ITEM_CATEGORIES,
      prefix: 'post.itemCategories',
    },
    {
      key: 'condition',
      label: 'post.condition',
      choices: ITEM_CONDITIONS,
      prefix: 'item.condition',
    },
    { key: 'brand', label: 'post.brand' },
    { key: 'suburb', label: 'post.suburb' },
  ],
  service: [
    {
      key: 'category',
      label: 'post.category',
      choices: SERVICE_CATEGORIES,
      prefix: 'post.serviceCategories',
    },
    {
      key: 'priceMode',
      label: 'post.priceMode',
      choices: PRICE_MODES,
      prefix: 'service.priceMode',
    },
    { key: 'serviceArea', label: 'post.serviceArea' },
  ],
};
export interface EditableListing {
  id: string;
  version: number;
  type: ListingType;
  title: string;
  body: string;
  intent: 'offer' | 'wanted';
  city: { id: string };
  priceMinor: number | null;
  details: Record<string, unknown>;
}
export function Publish({
  cities,
  onDone,
  initial,
}: {
  cities: { id: string; nameZh: string; nameEn: string }[];
  onDone: () => void;
  initial?: EditableListing;
}) {
  const t = label;
  const [type, setType] = useState<ListingType>(initial?.type ?? 'item');
  const [intent, setIntent] = useState(initial?.intent ?? 'offer');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [cityId, setCity] = useState(initial?.city.id ?? cities[0]?.id ?? '');
  const [price, setPrice] = useState(
    initial?.priceMinor == null ? '' : String(initial.priceMinor / 100),
  );
  const [detail, setDetail] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(initial?.details ?? {})
        .filter(([, v]) => v != null)
        .map(([k, v]) => [k, String(k.endsWith('Minor') ? Number(v) / 100 : v)]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <View style={{ gap: 12 }}>
      {!initial && (
        <Choices
          value={type}
          values={['housing', 'job', 'item', 'service']}
          onChange={(s) => {
            setType(s as ListingType);
            setDetail({});
          }}
          render={(s) => t(`listing.type.${s}`)}
        />
      )}
      <Choices
        value={intent}
        values={['offer', 'wanted']}
        onChange={(s) => setIntent(s as 'offer' | 'wanted')}
        render={(s) => t(`listing.intentLabel.${type}.${s}`)}
      />
      <Choices
        value={cityId}
        values={cities.map((c) => c.id)}
        onChange={setCity}
        render={(id) => {
          const c = cities.find((c) => c.id === id);
          return c?.nameZh ?? '';
        }}
      />
      {[
        [t('post.listingTitle'), title, setTitle],
        [t('post.body'), body, setBody],
        [t('post.price'), price, setPrice],
      ].map(([name, value, setter], index) => (
        <View key={index}>
          <Text>{name as string}</Text>
          <TextInput
            accessibilityLabel={name as string}
            style={{ borderWidth: 1, borderColor: '#ddd', padding: 12, borderRadius: 8 }}
            value={value as string}
            onChangeText={setter as (s: string) => void}
            multiline={index === 1}
            keyboardType={index === 2 ? 'decimal-pad' : 'default'}
          />
        </View>
      ))}
      {fields[type].map((field) => (
        <View key={field.key}>
          <Text>{t(field.label)}</Text>
          {field.choices ? (
            <Choices
              value={detail[field.key] ?? field.choices[0]}
              values={field.choices}
              onChange={(s) => setDetail((d) => ({ ...d, [field.key]: s }))}
              render={(s) => t(`${field.prefix}.${s}`)}
            />
          ) : (
            <TextInput
              accessibilityLabel={t(field.label)}
              value={detail[field.key] ?? ''}
              onChangeText={(s) => setDetail((d) => ({ ...d, [field.key]: s }))}
              keyboardType={field.numeric ? 'decimal-pad' : 'default'}
              style={{ borderWidth: 1, borderColor: '#ddd', padding: 12, borderRadius: 8 }}
            />
          )}
        </View>
      ))}
      {error && (
        <Text accessibilityRole="alert" style={{ color: '#b42336' }}>
          {error}
        </Text>
      )}
      <Button
        title={initial ? t('listing.saveEdit') : t('post.submit')}
        disabled={busy}
        onPress={() => {
          setBusy(true);
          setError('');
          void (async () => {
            const values: Record<string, unknown> = {
              ...Object.fromEntries(
                Object.entries(initial?.details ?? {}).filter(([, v]) => v != null),
              ),
            };
            for (const field of fields[type]) {
              const v = detail[field.key] ?? field.choices?.[0] ?? '';
              if (v !== '')
                values[field.key] = field.numeric
                  ? Math.round(Number(v) * (field.key.endsWith('Minor') ? 100 : 1))
                  : v;
              else delete values[field.key];
            }
            if (type === 'item')
              values.deliveryMethods = initial?.details.deliveryMethods ?? ['pickup'];
            const data = createListingSchema.parse({
              type,
              intent,
              title,
              body,
              cityId,
              priceMinor: price.trim() ? Math.round(Number(price) * 100) : undefined,
              contactPolicy: 'in_app',
              [type]: values,
            });
            await request(initial ? `/listings/${initial.id}` : '/listings', {
              method: initial ? 'PATCH' : 'POST',
              body: JSON.stringify(initial ? { version: initial.version, listing: data } : data),
            });
            onDone();
          })()
            .catch((e) => setError(e instanceof Error ? e.message : t('common.error')))
            .finally(() => setBusy(false));
        }}
      />
    </View>
  );
}

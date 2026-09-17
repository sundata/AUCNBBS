'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { BusinessReviewDto } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import { ReportButton } from './report-button';
import { ReviewForm, ReviewReplyForm } from './business-panels';

export function ReviewsList({
  businessId,
  initial,
  viewerIsOwner,
}: {
  businessId: string;
  initial: BusinessReviewDto[];
  viewerIsOwner: boolean;
}) {
  const t = useTranslations('businesses');
  const locale = useLocale() as AppLocale;
  const [reviews, setReviews] = useState(initial);
  return (
    <div className="space-y-4">
      {reviews.length === 0 && <p className="text-sm text-muted">{t('noReviews')}</p>}
      <ul className="space-y-4">
        {reviews.map((r) => (
          <li key={r.id} className="text-sm border-b border-gray-100 pb-3">
            <div className="text-xs text-muted">
              {'★'.repeat(r.rating)} · {r.author.displayName} · {formatDate(r.createdAt, locale)}
            </div>
            <p className="whitespace-pre-wrap mt-1">{r.body}</p>
            {r.reply && (
              <div className="mt-2 ml-4 border-l-2 border-gray-200 pl-3 text-xs">
                <span className="text-muted">{t('ownerReply')}: </span>
                {r.reply}
              </div>
            )}
            <div className="flex gap-3 items-center mt-1">
              <ReportButton subjectType="user" subjectId={r.author.id} />
              {viewerIsOwner && !r.reply && (
                <ReviewReplyForm
                  businessId={businessId}
                  reviewId={r.id}
                  onPosted={(reply) =>
                    setReviews((rows) => rows.map((x) => (x.id === r.id ? { ...x, reply } : x)))
                  }
                />
              )}
            </div>
          </li>
        ))}
      </ul>
      <ReviewForm
        businessId={businessId}
        onPosted={(review) => setReviews((rows) => [review, ...rows])}
      />
    </div>
  );
}

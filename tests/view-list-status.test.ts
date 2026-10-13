import { describe, expect, it } from 'vitest';
import {
  isPipelineSummaryText,
  parseViewListStatus,
  viewListStatusIcon,
  viewListStatusTone,
  withoutPipelineSummaryItems,
} from '../src/app/core/utils/view-list-status';

describe('parseViewListStatus', () => {
  it('мапит GitLab job statuses', () => {
    expect(parseViewListStatus('success')?.kind).toBe('success');
    expect(parseViewListStatus('failed')?.kind).toBe('failed');
    expect(parseViewListStatus('running')?.kind).toBe('running');
    expect(parseViewListStatus('pending')?.kind).toBe('pending');
    expect(parseViewListStatus('created')?.kind).toBe('pending');
    expect(parseViewListStatus('canceled')?.kind).toBe('canceled');
    expect(parseViewListStatus('cancelled')?.kind).toBe('canceled');
    expect(parseViewListStatus('skipped')?.kind).toBe('skipped');
    expect(parseViewListStatus('manual')?.kind).toBe('manual');
  });

  it('мапит approval meta', () => {
    expect(parseViewListStatus('approved')?.kind).toBe('approved');
    expect(parseViewListStatus('approved by alice')?.kind).toBe('approved');
    expect(parseViewListStatus('unapproved')?.kind).toBe('unapproved');
    expect(parseViewListStatus('no approvals')?.kind).toBe('unapproved');
    expect(parseViewListStatus('approvals: 0/1')?.kind).toBe('unapproved');
    expect(parseViewListStatus('approvals: 1/1')?.kind).toBe('approved');
    expect(parseViewListStatus('waiting for approval')?.kind).toBe('unapproved');
  });

  it('берёт статус из text если meta пустая (Approval)', () => {
    expect(parseViewListStatus(undefined, 'Approval')?.kind).toBeUndefined();
    expect(parseViewListStatus('', 'MR approvals')?.kind).toBeUndefined();
  });

  it('игнорирует произвольный meta', () => {
    expect(parseViewListStatus('mergeable')).toBeNull();
    expect(parseViewListStatus('opened')).toBeNull();
  });

  it('иконка и тон стабильны', () => {
    const s = parseViewListStatus('success')!;
    expect(viewListStatusIcon(s)).toBeTruthy();
    expect(viewListStatusTone(s)).toBe('ok');
    expect(viewListStatusTone(parseViewListStatus('failed')!)).toBe('err');
    expect(viewListStatusTone(parseViewListStatus('running')!)).toBe('run');
    expect(viewListStatusTone(parseViewListStatus('approved')!)).toBe('ok');
    expect(viewListStatusTone(parseViewListStatus('unapproved')!)).toBe('warn');
  });
});

describe('pipeline summary row', () => {
  it('распознаёт и отфильтровывает pipeline #N', () => {
    expect(isPipelineSummaryText('pipeline #216623')).toBe(true);
    expect(isPipelineSummaryText('lint')).toBe(false);
    expect(
      withoutPipelineSummaryItems([
        { text: 'pipeline #216623', meta: 'failed' },
        { text: 'lint', meta: 'failed' },
      ]),
    ).toEqual([{ text: 'lint', meta: 'failed' }]);
  });
});

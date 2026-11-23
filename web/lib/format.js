// 표시용 포맷 함수들

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** innerHTML에 넣기 전 반드시 거치는 이스케이프 */
export const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const fmtInt = (n) => Math.round(n).toLocaleString('ko-KR');

/** 분 → "45분", "1시간 5분", "2시간" */
export function fmtMin(m) {
  m = Math.round(m);
  if (m < 60) return `${m}분`;
  return m % 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m / 60}시간`;
}

/** 분 → h:mm (월 요약용) */
export function fmtShort(m) {
  m = Math.round(m);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** 상대 시간: 방금 전 / N분 전 / N시간 전 / N일 전. 해석 불가면 빈 문자열 */
export function relativeLabel(iso, now = new Date()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const min = Math.floor((now.getTime() - t) / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  if (min < 1440) return `${Math.floor(min / 60)}시간 전`;
  return `${Math.floor(min / 1440)}일 전`;
}

/** 심박 표시: 평균/최고를 따로 보여 주고, 둘 다 없을 때만 "심박 없음" */
export function hrHTML(avg, max) {
  const a = isNum(avg), m = isNum(max);
  if (!a && !m) return '<span class="na"><em>♥</em>심박 없음</span>';
  return (a ? `<span><em>♥ 평균</em>${escapeHtml(Math.round(avg))}</span>` : '')
    + (m ? `<span><em>${a ? '' : '♥ '}최고</em>${escapeHtml(Math.round(max))}</span>` : '');
}

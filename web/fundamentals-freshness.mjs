// 2026-10-28 user instruction: the collector stores Yahoo ANNUAL (12M) figures, which a filing changes once a year,
// so a 24-hour collection rule only re-read the same numbers and held every view between runs. The runner re-reads a
// stock weekly to catch a new filing, and the stored numbers stay valid for 30 days (a Yahoo outage no longer wipes them).
export const FUNDAMENTALS_RECHECK_DAYS=7,FUNDAMENTALS_MAX_AGE_DAYS=30;
export const FUNDAMENTALS_CHECK_NAME=`재무 수집 ${FUNDAMENTALS_MAX_AGE_DAYS}일 이내`;
export const fundamentalsCurrent=(f,now=Date.now())=>{const stamp=Date.parse(f?.fetchedAt);return Number.isFinite(stamp)&&Math.abs(now-stamp)<FUNDAMENTALS_MAX_AGE_DAYS*86400000;};

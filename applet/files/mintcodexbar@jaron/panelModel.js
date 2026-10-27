// Pure presentation model, shared by the Cinnamon applet and its tests.
function accountKey(account) {
    return account.id || account.provider + ':' + account.name;
}
function windowKind(label) {
    return /^Session/.test(label) ? 'session' : label === 'Weekly' ? 'weekly' : null;
}
// Every account is listed; `excluded` only removes accounts from the totals,
// so newly added accounts count automatically.
function summarize(accounts, excluded) {
    let counted = accounts.filter(a => !a.disabled && excluded.indexOf(accountKey(a)) === -1);
    let totals = { session: null, weekly: null };
    let missing = 0;
    counted.forEach(a => {
        if (a.error || !a.windows.length) { missing++; return; }
        a.windows.forEach(w => {
            let kind = windowKind(w.label);
            if (kind) totals[kind] = (totals[kind] || 0) + w.remaining;
        });
    });
    return {
        counted: counted,
        session: totals.session === null ? null : Math.round(totals.session),
        weekly: totals.weekly === null ? null : Math.round(totals.weekly),
        missing: missing
    };
}
// Saved order first; accounts not in it yet keep their discovery order at the end.
function orderAccounts(accounts, order) {
    let rank = a => { let i = order.indexOf(accountKey(a)); return i === -1 ? order.length : i; };
    return accounts.map((a, i) => [a, i]).sort((x, y) => rank(x[0]) - rank(y[0]) || x[1] - y[1]).map(x => x[0]);
}
// Remaining percentage if the window were used at a steady pace (the "even usage" marker).
function evenRemaining(w, now) {
    if (!w.resetsAt || !w.windowSeconds) return null;
    let left = (new Date(w.resetsAt).getTime() - now) / 1000;
    return Math.max(0, Math.min(100, left / w.windowSeconds * 100));
}

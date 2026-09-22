// V1 scope control (see product spec "ItemCase Anleitung für Version 1"):
// Forum, Freunde, Gruppen, Chat, CommunityMarkt and Händlermodus are built
// but must not be publicly reachable in the first public release. Nothing
// here is deleted — it's gated behind server-checked flags so a client-side
// hide can never accidentally expose it. Default is OFF for everything not
// part of V1; set the matching env var to "1" to re-enable for internal
// testing/staging without a code change.
const FEATURES = {
  forum: process.env.FEATURE_FORUM === '1',
  friends: process.env.FEATURE_FRIENDS === '1',
  groups: process.env.FEATURE_GROUPS === '1',
  chat: process.env.FEATURE_CHAT === '1',
  market: process.env.FEATURE_MARKET === '1',
  dealer: process.env.FEATURE_DEALER === '1'
};

function isFeatureEnabled(name) {
  return !!FEATURES[name];
}

// 404, not 403 — a disabled-for-V1 route must look like it doesn't exist,
// not like an access-control decision (no hint to probe further).
function requireFeature(name) {
  return (req, res, next) => {
    if (!isFeatureEnabled(name)) return res.status(404).json({ error: 'not found' });
    next();
  };
}

module.exports = { FEATURES, isFeatureEnabled, requireFeature };

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://192.168.2.39:5100/api';
const TOKEN_KEY = 'itemcase_mobile_token';

const token = () => sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);

async function request(path, { method = 'GET', body, auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && token()) headers.Authorization = `Bearer ${token()}`;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(data?.error || `API request failed (${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function result(action, fallback = null) {
  return action().catch(() => fallback);
}

function okResult(action) {
  return action().then((value) => ({ ok: true, ...value })).catch((error) => ({ ok: false, error: error.message, code: error.data?.code }));
}

function saveToken(value, persistent) {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  (persistent ? localStorage : sessionStorage).setItem(TOKEN_KEY, value);
}

function pickImage() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

const noSubscription = () => () => {};
const collectionCall = (path, options) => request(`/collection${path}`, { auth: true, ...options });

export function createMobileApi() {
  return {
    setTitleBarColor: async () => true,
    getAll: async () => {
      const collection = token() ? await request('/collection', { auth: true }) : { items: [], categories: [], categoryImages: {}, categoryFields: {}, categoryTargets: {}, categoryCaseDesigns: {} };
      const [catalog, catalogCategories] = await Promise.all([
        result(() => request('/catalog'), []),
        result(() => request('/catalog/categories'), [])
      ]);
      return { ...collection, communityCatalog: catalog.map((item) => ({ ...item, imagePath: item.imageUrl || null })), catalogCategories };
    },
    saveItem: (item) => collectionCall('/items', { method: 'POST', body: { ...item, imageData: item.imagePath || null } }),
    deleteItem: (id) => collectionCall(`/items/${id}`, { method: 'DELETE' }),
    addCategory: (category) => collectionCall('/categories', { method: 'POST', body: { category } }),
    renameCategory: (oldName, newName) => collectionCall('/categories/rename', { method: 'POST', body: { oldName, newName } }),
    deleteCategory: (category) => collectionCall(`/categories/${encodeURIComponent(category)}`, { method: 'DELETE' }),
    setCategoryImage: (name, imageData) => collectionCall(`/categories/${encodeURIComponent(name)}/image`, { method: 'PUT', body: { imageData } }),
    setCategoryFields: (name, fields) => collectionCall(`/categories/${encodeURIComponent(name)}/fields`, { method: 'PUT', body: { fields } }),
    setCategoryTarget: (name, target) => collectionCall(`/categories/${encodeURIComponent(name)}/target`, { method: 'PUT', body: { target } }),
    setCategoryCaseDesign: (name, caseDesign) => collectionCall(`/categories/${encodeURIComponent(name)}/case-design`, { method: 'PUT', body: { caseDesign } }),
    setCategoryOrder: (order) => collectionCall('/categories/order', { method: 'PUT', body: { order } }),
    submitToCatalog: (payload) => request('/catalog', { method: 'POST', auth: true, body: { ...payload, imageData: payload.imagePath || null } }).then(() => request('/catalog')),
    proposeCatalogPhoto: (payload) => request(`/catalog/${payload.catalogItemId}/photo`, { method: 'POST', auth: true, body: { ...payload, imageData: payload.imagePath || null } }),
    proposeCatalogCategory: (name) => request('/catalog/categories', { method: 'POST', auth: true, body: { name } }),
    pickImage,
    getImagePath: async (value) => value,
    sendFeedback: (body) => result(() => request('/feedback', { method: 'POST', auth: true, body: { ...body, appVersion: '1.0.0', platform: 'android' } }), true),
    reportCatalogEntry: (body) => result(() => request('/reports', { method: 'POST', auth: true, body }), true),
    exportZip: async () => false,
    importZip: async () => ({ ok: false, reason: 'unsupported' }),
    exportCsv: async () => false,
    importCsv: async () => ({ ok: false, reason: 'unsupported' }),
    exportPdf: async () => false,
    pickImportSpreadsheet: async () => null,
    getCaptcha: () => okResult(async () => await request('/auth/captcha')),
    register: (body) => okResult(async () => await request('/auth/register', { method: 'POST', body })),
    resendVerification: (email) => okResult(async () => await request('/auth/resend-verification', { method: 'POST', body: { email } })),
    login: (body) => okResult(async () => { const data = await request('/auth/login', { method: 'POST', body }); saveToken(data.token, body.rememberMe); return { user: data.user }; }),
    changePassword: (body) => okResult(async () => { const data = await request('/auth/change-password', { method: 'POST', auth: true, body }); saveToken(data.token, !!localStorage.getItem(TOKEN_KEY)); return {}; }),
    setTariff: (tariff) => okResult(async () => { const data = await request('/auth/tariff', { method: 'PATCH', auth: true, body: { tariff } }); saveToken(data.token, !!localStorage.getItem(TOKEN_KEY)); return { user: data.user }; }),
    logout: async () => { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY); return true; },
    getSession: async () => token() ? result(async () => (await request('/auth/me', { auth: true })).user, null) : null,
    friendsList: () => result(() => request('/friends', { auth: true }), { friends: [], incoming: [], outgoing: [] }),
    friendsSendRequest: (identifier) => okResult(async () => { await request('/friends/requests', { method: 'POST', auth: true, body: { identifier } }); return {}; }),
    friendsAcceptRequest: (id) => result(() => request(`/friends/requests/${id}/accept`, { method: 'POST', auth: true }), false),
    friendsDeclineRequest: (id) => result(() => request(`/friends/requests/${id}/decline`, { method: 'POST', auth: true }), false),
    blocksList: () => result(() => request('/blocks', { auth: true }), []),
    blockUser: (userId) => result(() => request('/blocks', { method: 'POST', auth: true, body: { userId } }), false),
    unblockUser: (userId) => result(() => request(`/blocks/${userId}`, { method: 'DELETE', auth: true }), false),
    groupsList: () => result(() => request('/groups', { auth: true }), []),
    groupsDiscover: () => result(() => request('/groups/discover', { auth: true }), []),
    groupsCreate: (body) => okResult(async () => ({ group: await request('/groups', { method: 'POST', auth: true, body }) })),
    groupsGet: (id) => result(() => request(`/groups/${id}`, { auth: true }), null),
    groupsJoin: (id) => okResult(async () => { await request(`/groups/${id}/join`, { method: 'POST', auth: true }); return {}; }),
    groupsAddMember: (id, username) => okResult(async () => { await request(`/groups/${id}/members`, { method: 'POST', auth: true, body: { username } }); return {}; }),
    groupsSetRole: (id, userId, role) => okResult(async () => { await request(`/groups/${id}/members/${userId}`, { method: 'PATCH', auth: true, body: { role } }); return {}; }),
    groupsKick: (id, userId) => okResult(async () => { await request(`/groups/${id}/members/${userId}`, { method: 'DELETE', auth: true }); return {}; }),
    groupsBan: (id, userId) => okResult(async () => { await request(`/groups/${id}/ban/${userId}`, { method: 'POST', auth: true }); return {}; }),
    groupsDelete: (id) => okResult(async () => { await request(`/groups/${id}`, { method: 'DELETE', auth: true }); return {}; }),
    conversationsList: () => result(() => request('/conversations', { auth: true }), []),
    conversationsOpenDirect: (friendId) => okResult(async () => await request('/conversations/direct', { method: 'POST', auth: true, body: { friendId } })),
    conversationsHistory: (id, before) => result(() => request(`/conversations/${id}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`, { auth: true }), []),
    conversationsSend: (id, body) => okResult(async () => ({ message: await request(`/conversations/${id}/messages`, { method: 'POST', auth: true, body: { body } }) })),
    conversationsMarkRead: (id) => result(() => request(`/conversations/${id}/read`, { method: 'POST', auth: true }), false),
    notificationsList: () => result(() => request('/notifications', { auth: true }), []),
    notificationsMarkRead: (id) => result(() => request(`/notifications/${id}/read`, { method: 'POST', auth: true }), false),
    notificationsMarkAllRead: () => result(() => request('/notifications/read-all', { method: 'POST', auth: true }), false),
    onNewMessage: noSubscription,
    onNewNotification: noSubscription,
    onTyping: noSubscription,
    wishlistList: () => result(() => request('/wishlist', { auth: true }), []),
    wishlistAdd: (body) => okResult(async () => ({ items: await request('/wishlist', { method: 'POST', auth: true, body }) })),
    wishlistUpdate: ({ id, ...body }) => okResult(async () => ({ items: await request(`/wishlist/${id}`, { method: 'PUT', auth: true, body }) })),
    wishlistRemove: (id) => okResult(async () => ({ items: await request(`/wishlist/${id}`, { method: 'DELETE', auth: true }) })),
    forumListThreads: (category) => result(() => request(`/forum/threads${category ? `?category=${encodeURIComponent(category)}` : ''}`, { auth: true }), []),
    forumCreateThread: (body) => okResult(async () => await request('/forum/threads', { method: 'POST', auth: true, body: { ...body, imageData: body.imagePath || null } })),
    forumGetThread: (id) => result(() => request(`/forum/threads/${id}`, { auth: true }), null),
    forumReply: (threadId, body, level) => okResult(async () => ({ post: await request(`/forum/threads/${threadId}/posts`, { method: 'POST', auth: true, body: { body, level } }) })),
    forumTrending: () => result(() => request('/forum/trending', { auth: true }), []),
    forumLeaderboard: () => result(() => request('/forum/leaderboard', { auth: true }), []),
    forumActiveCollectors: () => result(() => request('/forum/active-collectors', { auth: true }), []),
    forumActivity: () => result(() => request('/forum/activity', { auth: true }), []),
    forumCloseThread: (id) => result(() => request(`/forum/threads/${id}/close`, { method: 'POST', auth: true }), null),
    forumDeleteThread: (id) => result(() => request(`/forum/threads/${id}`, { method: 'DELETE', auth: true }), false),
    forumDeletePost: (id) => okResult(async () => { await request(`/forum/posts/${id}`, { method: 'DELETE', auth: true }); return {}; }),
    forumLikePost: (id) => result(() => request(`/forum/posts/${id}/like`, { method: 'POST', auth: true }), null),
    adminLoad: async () => ({ ok: false, error: 'Die Administration ist in der mobilen App nicht verfügbar.' }),
    adminAction: async () => ({ ok: false, error: 'Die Administration ist in der mobilen App nicht verfügbar.' })
  };
}

/**
 * Privy 3.51 keeps the refresh token in localStorage and deletes the login
 * when that copy is missing. HttpOnly mode stores the session in a cookie the
 * page cannot read, then this SDK treats the missing copy as logout.
 *
 * When Privy has switched to server cookies (`useServerCookies`), keep the
 * access token in memory for the open page and leave the persistent session
 * in the cookie. Do not write either secret into localStorage.
 */

const REPLACEMENTS = Object.freeze([
  [
    'return this.mightHaveServerCookies||t&&n',
    'return this.mightHaveServerCookies||t&&n||this.client?.useServerCookies===!0',
  ],
  [
    'if(!(e&&t||this.mightHaveServerCookies))return null',
    'if(!(e&&t||this.mightHaveServerCookies||this.client?.useServerCookies))return null',
  ],
  [
    '"ignore"===e.session_update_action&&(e.token&&(',
    '"ignore"===e.session_update_action&&(this.client?.useServerCookies===!0&&this.storeRefreshToken(null),e.token&&(',
  ],
  [
    'getToken(e){try{let t=B.get(e);return"string"==typeof t?St.throwIfNotWellFormedJwt(t):null}',
    'getToken(e){try{let t=this.client?.useServerCookies===!0?this._httpOnlyTokens?.[e]:null;if("string"!=typeof t)t=B.get(e);return"string"==typeof t?St.throwIfNotWellFormedJwt(t):null}',
  ],
  [
    'let t=B.get(m);B.put(m,e);',
    'let t=this.client?.useServerCookies===!0?this._httpOnlyTokens?.[m]:B.get(m);this.client?.useServerCookies===!0?(this._httpOnlyTokens||(this._httpOnlyTokens={}),this._httpOnlyTokens[m]=e,B.del(m)):B.put(m,e);',
  ],
  [
    'storePrivyAccessToken(e){"string"==typeof e?B.put(g,e):B.del(g)}',
    'storePrivyAccessToken(e){"string"==typeof e?this.client?.useServerCookies===!0?(this._httpOnlyTokens||(this._httpOnlyTokens={}),this._httpOnlyTokens[g]=e,B.del(g)):B.put(g,e):(this._httpOnlyTokens&&delete this._httpOnlyTokens[g],this.client?.useServerCookies===!0||B.del(g))}',
  ],
  [
    'storeRefreshToken(e){"string"==typeof e?(B.put(f,e),this.writeCookie(T,"t",{expires:30})):(B.del(f),ue.remove(k),ue.remove(T))}',
    'storeRefreshToken(e){"string"==typeof e?(this.client?.useServerCookies===!0?B.del(f):B.put(f,e),this.writeCookie(T,"t",{expires:30})):(B.del(f),this.client?.useServerCookies===!0||(ue.remove(k),ue.remove(T)))}',
  ],
  [
    '_getToken(e){try{let t=s.s.get(e);return"string"==typeof t?P.throwIfNotWellFormedJwt(t):null}',
    '_getToken(e){try{let t=this.client?.useServerCookies===!0?this._httpOnlyTokens?.[e]:null;if("string"!=typeof t)t=s.s.get(e);return"string"==typeof t?P.throwIfNotWellFormedJwt(t):null}',
  ],
  [
    'let t=s.s.get(i.CUSTOMER_ACCESS_TOKEN_STORAGE_KEY);s.s.put(i.CUSTOMER_ACCESS_TOKEN_STORAGE_KEY,e);',
    'let t=this.client?.useServerCookies===!0?this._httpOnlyTokens?.[i.CUSTOMER_ACCESS_TOKEN_STORAGE_KEY]:s.s.get(i.CUSTOMER_ACCESS_TOKEN_STORAGE_KEY);this.client?.useServerCookies===!0?(this._httpOnlyTokens||(this._httpOnlyTokens={}),this._httpOnlyTokens[i.CUSTOMER_ACCESS_TOKEN_STORAGE_KEY]=e,s.s.del(i.CUSTOMER_ACCESS_TOKEN_STORAGE_KEY)):s.s.put(i.CUSTOMER_ACCESS_TOKEN_STORAGE_KEY,e);',
  ],
  [
    'storePrivyAccessToken(e){"string"==typeof e?s.s.put(i.PRIVY_ACCESS_TOKEN_STORAGE_KEY,e):s.s.del(i.PRIVY_ACCESS_TOKEN_STORAGE_KEY)}',
    'storePrivyAccessToken(e){"string"==typeof e?this.client?.useServerCookies===!0?(this._httpOnlyTokens||(this._httpOnlyTokens={}),this._httpOnlyTokens[i.PRIVY_ACCESS_TOKEN_STORAGE_KEY]=e,s.s.del(i.PRIVY_ACCESS_TOKEN_STORAGE_KEY)):s.s.put(i.PRIVY_ACCESS_TOKEN_STORAGE_KEY,e):(this._httpOnlyTokens&&delete this._httpOnlyTokens[i.PRIVY_ACCESS_TOKEN_STORAGE_KEY],this.client?.useServerCookies===!0||s.s.del(i.PRIVY_ACCESS_TOKEN_STORAGE_KEY))}',
  ],
  [
    'storeRefreshToken(e){"string"==typeof e?(s.s.put(i.REFRESH_TOKEN_STORAGE_KEY,e),this.writeCookie(i.SESSION_COOKIE_KEY,"t",{expires:30})):(s.s.del(i.REFRESH_TOKEN_STORAGE_KEY),l.cookies.remove(i.REFRESH_TOKEN_COOKIE_KEY),l.cookies.remove(i.SESSION_COOKIE_KEY))}',
    'storeRefreshToken(e){"string"==typeof e?(this.client?.useServerCookies===!0?s.s.del(i.REFRESH_TOKEN_STORAGE_KEY):s.s.put(i.REFRESH_TOKEN_STORAGE_KEY,e),this.writeCookie(i.SESSION_COOKIE_KEY,"t",{expires:30})):(s.s.del(i.REFRESH_TOKEN_STORAGE_KEY),this.client?.useServerCookies===!0||(l.cookies.remove(i.REFRESH_TOKEN_COOKIE_KEY),l.cookies.remove(i.SESSION_COOKIE_KEY)))}',
  ],
  [
    'else B.del(m),ue.remove(_),this.client?.onDeleteCustomerAccessToken?.()',
    'else(this._httpOnlyTokens&&delete this._httpOnlyTokens[m],B.del(m)),ue.remove(_),this.client?.onDeleteCustomerAccessToken?.()',
  ],
  [
    'else s.s.del(i.CUSTOMER_ACCESS_TOKEN_STORAGE_KEY),l.cookies.remove(i.CUSTOMER_ACCESS_TOKEN_COOKIE_KEY),this.client?.onDeleteCustomerAccessToken?.()',
    'else(this._httpOnlyTokens&&delete this._httpOnlyTokens[i.CUSTOMER_ACCESS_TOKEN_STORAGE_KEY],s.s.del(i.CUSTOMER_ACCESS_TOKEN_STORAGE_KEY)),l.cookies.remove(i.CUSTOMER_ACCESS_TOKEN_COOKIE_KEY),this.client?.onDeleteCustomerAccessToken?.()',
  ],
  [
    'this._httpOnlyTokens[m]=e):B.put(m,e);',
    'this._httpOnlyTokens[m]=e,B.del(m)):B.put(m,e);',
  ],
  [
    'this._httpOnlyTokens[g]=e):B.put(g,e)',
    'this._httpOnlyTokens[g]=e,B.del(g)):B.put(g,e)',
  ],
  [
    'this.client?.useServerCookies===!0||B.put(f,e)',
    'this.client?.useServerCookies===!0?B.del(f):B.put(f,e)',
  ],
  [
    'this._httpOnlyTokens[i.CUSTOMER_ACCESS_TOKEN_STORAGE_KEY]=e):s.s.put(i.CUSTOMER_ACCESS_TOKEN_STORAGE_KEY,e);',
    'this._httpOnlyTokens[i.CUSTOMER_ACCESS_TOKEN_STORAGE_KEY]=e,s.s.del(i.CUSTOMER_ACCESS_TOKEN_STORAGE_KEY)):s.s.put(i.CUSTOMER_ACCESS_TOKEN_STORAGE_KEY,e);',
  ],
  [
    'this._httpOnlyTokens[i.PRIVY_ACCESS_TOKEN_STORAGE_KEY]=e):s.s.put(i.PRIVY_ACCESS_TOKEN_STORAGE_KEY,e)',
    'this._httpOnlyTokens[i.PRIVY_ACCESS_TOKEN_STORAGE_KEY]=e,s.s.del(i.PRIVY_ACCESS_TOKEN_STORAGE_KEY)):s.s.put(i.PRIVY_ACCESS_TOKEN_STORAGE_KEY,e)',
  ],
  [
    'this.client?.useServerCookies===!0||s.s.put(i.REFRESH_TOKEN_STORAGE_KEY,e)',
    'this.client?.useServerCookies===!0?s.s.del(i.REFRESH_TOKEN_STORAGE_KEY):s.s.put(i.REFRESH_TOKEN_STORAGE_KEY,e)',
  ],
  [
    'get refreshToken(){try{if(this.client?.useServerCookies===!0)return null;let e=B.get(f);return"string"==typeof e?e:null}',
    'get refreshToken(){try{let e=B.get(f);return"string"==typeof e?e:null}',
  ],
  [
    'get refreshToken(){try{if(this.client?.useServerCookies===!0)return null;let e=s.s.get(i.REFRESH_TOKEN_STORAGE_KEY);return"string"==typeof e?e:null}',
    'get refreshToken(){try{let e=s.s.get(i.REFRESH_TOKEN_STORAGE_KEY);return"string"==typeof e?e:null}',
  ],
  [
    'this.apiUrl=e,this.fallbackApiUrl=this.apiUrl,this.useServerCookies=e!==P&&e.startsWith("https://privy.")',
    'this.apiUrl=e===P&&typeof location<"u"?location.origin+"/api/privy-auth":e,this.fallbackApiUrl=this.apiUrl,this.useServerCookies=String(this.apiUrl).endsWith("/api/privy-auth")||e!==P&&e.startsWith("https://privy.")',
  ],
  [
    'this.apiUrl=e,this.fallbackApiUrl=this.apiUrl,this.useServerCookies=e!==i.DEFAULT_PRIVY_API_URL&&e.startsWith("https://privy.")',
    'this.apiUrl=e===i.DEFAULT_PRIVY_API_URL&&typeof location<"u"?location.origin+"/api/privy-auth":e,this.fallbackApiUrl=this.apiUrl,this.useServerCookies=String(this.apiUrl).endsWith("/api/privy-auth")||e!==i.DEFAULT_PRIVY_API_URL&&e.startsWith("https://privy.")',
  ],
  [
    'if(hn.setState({identityToken:e}),this.client?.useServerCookies)return;B.put(I,e);',
    'if(hn.setState({identityToken:e}),this.client?.useServerCookies)return void B.del(I);B.put(I,e);',
  ],
  [
    'if(re.setState({identityToken:e}),this.client?.useServerCookies)return;s.s.put(i.IDENTITY_TOKEN_STORAGE_KEY,e);',
    'if(re.setState({identityToken:e}),this.client?.useServerCookies)return void s.s.del(i.IDENTITY_TOKEN_STORAGE_KEY);s.s.put(i.IDENTITY_TOKEN_STORAGE_KEY,e);',
  ],
  [
    'this.useServerCookies&&this.session.mightHaveServerCookies&&!this.session.getToken(Ln.PRIVY)&&!this.session.getToken(Ln.CUSTOMER)',
    'this.useServerCookies&&!this.session.getToken(Ln.PRIVY)&&!this.session.getToken(Ln.CUSTOMER)',
  ],
  [
    'this.useServerCookies&&this.session.mightHaveServerCookies&&!this.session.getToken(n)',
    'this.useServerCookies&&!this.session.getToken(n)',
  ],
  [
    'this.useServerCookies&&this.session.mightHaveServerCookies&&!this.session.getToken(Se.PRIVY)&&!this.session.getToken(Se.CUSTOMER)',
    'this.useServerCookies&&!this.session.getToken(Se.PRIVY)&&!this.session.getToken(Se.CUSTOMER)',
  ],
]);

export function patchPrivyCookieSession(source) {
  let next = String(source);
  for (const [from, to] of REPLACEMENTS) {
    if (next.includes(to)) continue;
    next = next.replaceAll(from, to);
  }
  return next;
}

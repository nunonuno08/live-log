// Navigation helpers shared by the views. `hasHistory` tells whether an in-app page
// exists behind the current one, so a back button never leaves the app.
export const nav = {
  hasHistory: false,
  replacing: false,
  rerender: () => {},
};

export function goBack(fallback = '#/') {
  if (nav.hasHistory) history.back();
  else replace(fallback);
}

export function replace(hash) {
  nav.replacing = true;
  location.replace(hash);
}

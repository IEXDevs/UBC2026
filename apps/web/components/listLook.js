export function listLook(overrides = {}) {
  return {
    animation: 'pop',
    theme: 'dark',
    width: '100%',
    maxHeight: 440,
    radius: 14,
    gap: 8,
    stagger: 0.05,
    fadeSize: 56,
    frame: false,
    showGradients: false,
    displayScrollbar: true,
    selectOnHover: false,
    enableArrowNavigation: true,
    loop: false,
    animateOnce: false,
    initialSelectedIndex: -1,
    ...overrides,
  };
}

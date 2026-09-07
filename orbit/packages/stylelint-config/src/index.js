
export const orbitStylelintConfig = Object.freeze({
  ignoreFiles: ['**/node_modules/**', '**/dist/**', '**/orbit.css'],
  rules: {
    'color-no-hex': true,
    'declaration-no-important': true,
    'selector-max-id': 0,
    'selector-max-specificity': '0,4,0',
    'custom-property-pattern': '^orbit-[a-z0-9]+(?:-[a-z0-9]+)*$',
    'declaration-property-value-disallowed-list': {
      'border-radius': ['/^(?:[7-9]|[1-9][0-9]+)px$/'],
      'box-shadow': [/.+/],
      'background-image': [/gradient\(/i]
    }
  }
});
export default orbitStylelintConfig;

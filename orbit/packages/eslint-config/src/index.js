
const TOKEN_KEY = /(access|refresh|identity|id[_-]?token|bearer|jwt)/i;
const HEX = /#[0-9a-f]{3,8}\b/i;

function memberName(node) {
  if (!node?.computed && node?.property?.type === 'Identifier') return node.property.name;
  if (node?.computed && node?.property?.type === 'Literal') return node.property.value;
  return null;
}
function literalValue(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions?.length === 0) return node.quasis?.[0]?.value?.cooked || '';
  return null;
}

export const orbitPlugin = {
  meta: { name: '@corporate/eslint-config', version: '2.0.0' },
  rules: {
    'no-token-web-storage': {
      meta: { type: 'problem', docs: { description: 'Disallow browser token persistence' }, schema: [], messages: { forbidden: 'Do not persist authentication tokens in browser storage. Use the same-origin session client.' } },
      create(context) {
        return { CallExpression(node) {
          const callee = node.callee;
          if (callee?.type !== 'MemberExpression') return;
          const object = callee.object?.type === 'Identifier' ? callee.object.name : null;
          const method = memberName(callee);
          if (!['localStorage', 'sessionStorage'].includes(object) || !['setItem', 'getItem'].includes(method)) return;
          const key = literalValue(node.arguments?.[0]);
          if (typeof key === 'string' && TOKEN_KEY.test(key)) context.report({ node, messageId: 'forbidden' });
        }};
      }
    },
    'no-raw-orbit-color': {
      meta: { type: 'suggestion', docs: { description: 'Require Orbit token variables instead of raw colors' }, schema: [], messages: { forbidden: 'Use an Orbit semantic token instead of a raw color literal.' } },
      create(context) {
        function inspect(node) { const value = literalValue(node); if (typeof value === 'string' && HEX.test(value)) context.report({ node, messageId: 'forbidden' }); }
        return { Literal: inspect, TemplateLiteral: inspect };
      }
    },
    'no-unsafe-return-navigation': {
      meta: { type: 'problem', schema: [], messages: { forbidden: 'Return destinations must pass the shared safeReturnUrl validator before navigation.' } },
      create(context) {
        return { CallExpression(node) {
          const callee = node.callee;
          const method = callee?.type === 'MemberExpression' ? memberName(callee) : null;
          const object = callee?.object?.type === 'Identifier' ? callee.object.name : null;
          if (['location', 'window'].includes(object) && ['assign', 'replace'].includes(method) && literalValue(node.arguments?.[0]) === null) {
            context.report({ node, messageId: 'forbidden' });
          }
        }};
      }
    }
  }
};

export const orbitBrowserConfig = Object.freeze({
  name: 'codestra/orbit-browser',
  plugins: { orbit: orbitPlugin },
  rules: {
    'orbit/no-token-web-storage': 'error',
    'orbit/no-raw-orbit-color': 'error',
    'orbit/no-unsafe-return-navigation': 'error'
  }
});

export default [orbitBrowserConfig];

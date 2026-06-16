import vueParser from 'vue-eslint-parser'
import pluginVue from 'eslint-plugin-vue'
import pluginVueAccessibility from 'eslint-plugin-vuejs-accessibility'
import tsParser from '@typescript-eslint/parser'

const wxtGlobals = {
  browser: 'readonly', ref: 'readonly', computed: 'readonly',
  watch: 'readonly', watchEffect: 'readonly', watchPostEffect: 'readonly', watchSyncEffect: 'readonly',
  reactive: 'readonly', readonly: 'readonly', shallowReactive: 'readonly', shallowReadonly: 'readonly',
  shallowRef: 'readonly', isRef: 'readonly', isReactive: 'readonly', isReadonly: 'readonly',
  isShallow: 'readonly', isProxy: 'readonly', toRaw: 'readonly', toRef: 'readonly', toRefs: 'readonly',
  toValue: 'readonly', unref: 'readonly', triggerRef: 'readonly', markRaw: 'readonly',
  customRef: 'readonly', effectScope: 'readonly', getCurrentScope: 'readonly',
  getCurrentInstance: 'readonly', getCurrentWatcher: 'readonly', onScopeDispose: 'readonly',
  onWatcherCleanup: 'readonly', onMounted: 'readonly', onBeforeMount: 'readonly',
  onUnmounted: 'readonly', onBeforeUnmount: 'readonly', onUpdated: 'readonly',
  onBeforeUpdate: 'readonly', onActivated: 'readonly', onDeactivated: 'readonly',
  onErrorCaptured: 'readonly', onRenderTracked: 'readonly', onRenderTriggered: 'readonly',
  onServerPrefetch: 'readonly', provide: 'readonly', inject: 'readonly', nextTick: 'readonly', h: 'readonly',
  createApp: 'readonly', defineComponent: 'readonly', defineAsyncComponent: 'readonly',
  resolveComponent: 'readonly', useSlots: 'readonly', useAttrs: 'readonly', useCssModule: 'readonly',
  useCssVars: 'readonly', useModel: 'readonly', useId: 'readonly', useTemplateRef: 'readonly',
  storage: 'readonly', useAppConfig: 'readonly', getAppConfig: 'readonly', defineAppConfig: 'readonly',
  defineWxtPlugin: 'readonly', defineBackground: 'readonly', defineContentScript: 'readonly',
  defineUnlistedScript: 'readonly', injectScript: 'readonly', createIframeUi: 'readonly',
  createIntegratedUi: 'readonly', createShadowRootUi: 'readonly', ContentScriptContext: 'readonly',
  EffectScope: 'readonly', InvalidMatchPattern: 'readonly', MatchPattern: 'readonly',
  fakeBrowser: 'readonly', defineProps: 'readonly', defineEmits: 'readonly',
  defineExpose: 'readonly', withDefaults: 'readonly',
}

const localPlugin = {
  rules: {
    'icon-button-needs-label': {
      meta: { type: 'suggestion', docs: { description: 'Icon-only buttons must have aria-label or title' }, schema: [] },
      create(context) {
        const visitor = context.parserServices?.defineTemplateBodyVisitor
        if (!visitor) return {}
        return visitor({
          'VElement[name=button]'(node) {
            const children = node.children.filter(
              (c) => c.type === 'VElement' || (c.type === 'VText' && c.value.trim())
            )
            const hasIconOnly = children.length === 1 && children[0].type === 'VElement'
            if (!hasIconOnly) return

            const hasAria = node.startTag.attributes.some(
              (a) =>
                a.key?.name === 'aria-label' || a.key?.name === 'title' ||
                a.key?.name?.name === 'aria-label' || a.key?.name?.name === 'title' ||
                a.key?.argument?.name === 'aria-label'
            )
            if (!hasAria) {
              context.report({ node: node.startTag, message: 'Icon-only <button> must have aria-label or title attribute.' })
            }
          },
        })
      },
    },
    'no-raw-form-control': {
      meta: { type: 'suggestion', docs: { description: 'Ban raw <input type=checkbox|radio> outside of standard components' }, schema: [] },
      create(context) {
        const visitor = context.parserServices?.defineTemplateBodyVisitor
        if (!visitor) return {}
        return visitor({
          'VElement[name=input][attributes]'(node) {
            const typeAttr = node.startTag.attributes.find(
              (a) => a.key?.name === 'type' && (a.value?.value === 'checkbox' || a.value?.value === 'radio')
            )
            if (!typeAttr) return

            const hasSrOnly = node.startTag.attributes.some(
              (a) => a.key?.name === 'class' && a.value?.value?.includes('sr-only')
            )
            if (hasSrOnly) return

            context.report({
              node: node.startTag,
              message: `Raw <input type="${typeAttr.value?.value}"> detected. Use ToggleSwitch/Checkbox/RadioGroup component instead.`,
            })
          },
        })
      },
    },
  },
}

const vuePluginObj = pluginVue.default || pluginVue['module.exports'] || pluginVue

export default [
  { ignores: ['.wxt/**', '.output/**', 'dist/**', 'node_modules/**', '.claude/**'] },

  ...vuePluginObj.configs['flat/essential'],
  ...pluginVueAccessibility.configs['flat/recommended'],

  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: tsParser, sourceType: 'module', ecmaVersion: 'latest' },
      globals: { ...wxtGlobals },
    },
    plugins: { local: localPlugin },
    rules: {
      'no-undef': 'off',

      'vue/no-restricted-class': ['error',
        '/^text-(gray|slate|zinc|stone|neutral)-/',
        '/^bg-(gray|slate|zinc|stone|neutral)-/',
        '/^text-(yellow|amber)-/',
        '/^bg-(yellow|amber)-/',
        '/^ring-(yellow|amber)-/',
        '/^border-(yellow|amber)-/',
        '/^rounded$/',
        '/^bg-white$/',
        '/^bg-black$/',
        '/\\[#[0-9a-fA-F]{3,8}\\]/',
      ],

      'vuejs-accessibility/form-control-has-label': 'error',
      'local/icon-button-needs-label': 'error',
      'local/no-raw-form-control': 'error',

      'vue/component-name-in-template-casing': ['error', 'PascalCase'],
      'vue/multi-word-component-names': ['error', {
        'ignores': ['IconButton', 'ConfirmInline', 'OverflowMenu', 'FormField', 'ToggleSwitch', 'RadioGroup', 'Checkbox'],
      }],
      'vue/no-mutating-props': 'error',
    },
  },

  {
    files: ['**/*.ts', '**/*.mjs', '**/*.js'],
    languageOptions: { parser: tsParser, parserOptions: { sourceType: 'module', ecmaVersion: 'latest' } },
    rules: { 'no-undef': 'off' },
  },
]

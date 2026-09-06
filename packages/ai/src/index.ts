// Клиенты Fal.ai, Anthropic и Voyage, каталог стилей и сборка промптов.
export {
  cosine,
  createVoyageEmbedder,
  EMBEDDING_DIMENSIONS,
  nearestStyles,
  styleTagsFromVector,
  styleVector,
} from './embed'
export {
  type ConceptModelId,
  conceptModelIds,
  conceptModels,
  createFalRenderer,
  createSampleRenderer,
  isConceptModelId,
  RenderError,
} from './fal'
export {
  buildTemplatePlan,
  createClaudePromptBuilder,
  createFalLlmPromptBuilder,
  createPromptBuilder,
  createTemplatePromptBuilder,
  fixedPreamble,
  styleOrDefault,
} from './prompt'
export {
  findStyle,
  type StyleEntry,
  type StyleFamily,
  styleFamilies,
  styleFamilyLabels,
  styleIds,
  styleLibrary,
  stylesByFamily,
} from './styles'
export type {
  ConceptBrief,
  ConceptRenderer,
  Embedder,
  EmbedInput,
  PromptBuilder,
  PromptPlan,
  RenderRequest,
  RenderResult,
} from './types'

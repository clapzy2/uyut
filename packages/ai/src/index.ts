// Клиенты Fal.ai, Anthropic и Voyage, каталог стилей и сборка промптов.
export { budgetShares, MATCH_CONFIDENCE_THRESHOLD, type PriceWindow, priceWindow } from './budget'
export {
  createFalDetector,
  type DetectedObject,
  type Detector,
  detectorCaption,
  type NormalizedBox,
  type RoomKind,
  selectObjects,
} from './detect'
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
export { downloadFalFile, FalError, falQueue, toDataUri } from './fal-queue'
export {
  buildTemplatePlan,
  createClaudePromptBuilder,
  createFalLlmPromptBuilder,
  createPromptBuilder,
  createTemplatePromptBuilder,
  fixedPreamble,
  styleOrDefault,
} from './prompt'
export { createFalSegmenter, type Segmenter } from './segment'
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

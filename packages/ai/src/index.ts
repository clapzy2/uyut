// Клиенты Fal.ai, Anthropic и Voyage, каталог стилей и сборка промптов.

export {
  BRIEF_SECTIONS,
  BRIEF_SYSTEM_PROMPT,
  type BriefGenerator,
  type BriefInput,
  type BriefProjectInput,
  type BriefRoomInput,
  briefHash,
  buildBriefPrompt,
  createFalBriefGenerator,
  parseBrief,
} from './brief'
export {
  budgetShares,
  MATCH_CONFIDENCE_THRESHOLD,
  MATCH_FLOOR,
  type PriceWindow,
  priceWindow,
} from './budget'
export {
  type AgentReply,
  ASSISTANT_PERSONA,
  buildSystemPrompt,
  buildTranscript,
  chatTools,
  completeFalLlm,
  looksLikeToolCall,
  parseAgentReply,
  RESET_MARK,
  streamFalLlm,
  type ToolSpec,
  type TranscriptTurn,
} from './chat'
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
  buildDuoPrompt,
  compactDuoInput,
  createFalDuoProposer,
  DUO_BRIDGES,
  DUO_MODEL,
  DUO_SYSTEM_PROMPT,
  type DuoBridge,
  type DuoConcept,
  type DuoInput,
  type DuoProposal,
  type DuoProposer,
  type DuoSide,
  duoHash,
  parseDuoProposal,
} from './duo'
export {
  buildEditPlan,
  type EditPlan,
  type EditStep,
  KEEP_THE_REST,
  parseEditPlan,
} from './edit-plan'
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
  applyRecheck,
  checkTotalArea,
  createFalPlanReader,
  createFalSideReader,
  estimateSides,
  FLOOR_PLAN_PROMPT,
  isUtilityRoom,
  markChainMismatch,
  mergeReadings,
  needsRecheck,
  PLAN_READER_MODEL,
  type PlanReader,
  type PlanReading,
  type PlanRoom,
  type PlanSide,
  parseFloorPlan,
  parseSideRecheck,
  roomKindFromName,
  SIDE_RECHECK_PROMPT,
  type SideReader,
} from './floor-plan'
export {
  buildTemplatePlan,
  createClaudePromptBuilder,
  createFalLlmPromptBuilder,
  createPromptBuilder,
  createTemplatePromptBuilder,
  fixedPreamble,
  mandateSentence,
  styleOrDefault,
} from './prompt'
export { closeMask, maskWeights, meanLightness, type RecolorTarget, recolorPixels } from './recolor'
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
export {
  APPROXIMATE_LIGHTNESS_DELTA,
  findSwatch,
  type Hsl,
  hexToHsl,
  hslToRgb,
  isApproximate,
  rgbToHsl,
  type Swatch,
  type SwatchAvailability,
  type SwatchClass,
  swatchAvailability,
  swatchClasses,
  swatchClassLabels,
  swatches,
} from './swatches'
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

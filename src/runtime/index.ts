export * from "./math";
export * from "./project/format";
export { Emitter } from "./core/events";
export { defineBlock, getBlockDef, listBlockDefs, resolveProps, BlockInstance } from "./core/block";
export type { BlockDef, BlockSpec, PropSchema, PropType, PropOption, NamedInfo } from "./core/block";
export { Entity } from "./core/entity";
export type { Intent, SpriteState, Direction } from "./core/entity";
export { Scene, mergeBlocks } from "./core/scene";
export { Camera } from "./core/camera";
export { Game, LOCKED_ACTIONS } from "./core/game";
export type { GameOptions, LogLevel, DebugState } from "./core/game";
export { Renderer } from "./render/renderer";
export type { Texture, TextStyle, BlendMode } from "./render/renderer";
export { SCREEN_EFFECTS, screenEffectIndex } from "./render/effects";
export type { ScreenEffect } from "./render/effects";
export {
  BUILTIN_FONTS,
  DEFAULT_FONT_ID,
  SANS_CSS,
  PIXEL_GLYPHS,
  TINY_GLYPHS,
  bitmapFont,
  canDrawBitmap,
  drawBitmapText,
  fontCss,
  fontFamilyName,
  glyphRows,
  isBuiltinFont,
  measureBitmapText,
} from "./render/fonts";
export type { BitmapFont, FontInfo } from "./render/fonts";
export { mountTouchControls, wantsTouch } from "./input/touch";
export type { SceneEffect } from "./core/scene";
export { Translator } from "./i18n/translator";
export { applyEffect, applyLoop, spawnImpact, ONE_SHOT_EFFECTS, LOOP_EFFECTS } from "./blocks/juice";
export { drawArc, drawRay } from "./render/shapes";
export { identityFx } from "./core/entity";
export type { SpriteFX } from "./core/entity";
export type { SpriteTransform } from "./render/sprites";
export { collectTexts, missingTranslations, ENGINE_TEXTS } from "./project/texts";
export type { TextEntry } from "./project/texts";
export { drawSpriteFrame, spriteBounds } from "./render/sprites";
export type { Origin } from "./render/sprites";
export { Assets, frameRect } from "./assets/assets";
export type { LoadedImage } from "./assets/assets";
export { AudioSystem } from "./audio/audio";
export {
  DEFAULT_SFX,
  DRUMS,
  SAMPLE_RATE,
  SFX_PRESETS,
  WAVES,
  createSong,
  makeSfx,
  midiToFreq,
  renderSfx,
  renderSong,
  rng,
  sfxSeconds,
  songSeconds,
  stepSeconds,
} from "./audio/synth";
export type { SfxData, SfxPreset, SongChannel, SongData, SongNote, Wave } from "./audio/synth";
export { Input } from "./input/input";
export { BodyState } from "./physics/body";
export { CollisionGrid, COLL } from "./physics/collision";
export { drawTileLayer, buildCollisionGrid } from "./world/tilemap";
export { registerBuiltinBlocks, BLOCK_CATEGORIES } from "./blocks";
export { interpolate } from "./blocks/text";
export {
  RuleSystem,
  RULE_ITEMS,
  RULE_CATEGORIES,
  COMPARE_OPTIONS,
  getRuleItemDef,
  splitRuleKey,
  compareValues,
  parseValue,
} from "./rules/rules";
export type { RuleCtx, RuleItemDef, RuleKind } from "./rules/rules";
export { validateProject } from "./project/validate";
export { DialogueRunner } from "./dialogue/dialogue";
export type { ActiveDialogue } from "./dialogue/dialogue";
export { findPath, lineOfSight, walkable } from "./world/pathfinding";
export type { Cell } from "./world/pathfinding";
export { bodyCenter, nearestTagged, facingVector } from "./blocks/targets";
export { unregisterCustomBlocks, CUSTOM_PROP_TYPES } from "./core/block";
export { loadScripts } from "./scripting/loader";
export type { ScriptResult } from "./scripting/loader";
export { compilePython, PythonError, PY_METHOD_NAMES } from "./scripting/python";
export { PY, setScriptLogger } from "./scripting/pyruntime";
export { describeScriptError } from "./scripting/errors";
export type { ProjectIssue, IssueLevel } from "./project/validate";

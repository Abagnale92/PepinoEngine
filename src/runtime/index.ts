export * from "./math";
export * from "./project/format";
export { Emitter } from "./core/events";
export { defineBlock, getBlockDef, listBlockDefs, resolveProps, BlockInstance } from "./core/block";
export type { BlockDef, BlockSpec, PropSchema, PropType, PropOption, NamedInfo } from "./core/block";
export { Entity } from "./core/entity";
export type { Intent, SpriteState, Direction } from "./core/entity";
export { Scene, mergeBlocks } from "./core/scene";
export { Camera } from "./core/camera";
export { Game } from "./core/game";
export type { GameOptions, LogLevel, DebugState } from "./core/game";
export { Renderer } from "./render/renderer";
export type { Texture, TextStyle } from "./render/renderer";
export { drawSpriteFrame, spriteBounds } from "./render/sprites";
export type { Origin } from "./render/sprites";
export { Assets, frameRect } from "./assets/assets";
export type { LoadedImage } from "./assets/assets";
export { AudioSystem } from "./audio/audio";
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
export type { ProjectIssue, IssueLevel } from "./project/validate";

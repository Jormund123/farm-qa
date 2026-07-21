import type { Feature, FeatureCollection, Geometry } from "geojson";

/** A GeoJSON property value as JSON allows it. */
export type PropValue = string | number | boolean | null;
export type PlotProperties = Record<string, PropValue>;

// Mirrors farmqa.report.QAReport (dataclasses.asdict shape).
export interface GeometryIssue {
  index: number;
  reason: string;
  fixable: boolean;
}

export interface Duplicates {
  exact: number[][];
  normalized: number[][];
  near: number[][];
  overlaps: number[][];
}

export interface QAReport {
  count: number;
  geometry_types: Record<string, number>;
  crs: string;
  had_z: boolean;
  total_area_ha: number;
  area_method: string;
  invalid: GeometryIssue[];
  duplicates: Duplicates;
  by_property: Record<string, Record<string, number>>;
  warnings: string[];
}

export interface UploadResponse {
  fileId: string;
  featureCount: number;
  qa: QAReport;
}

export interface GeometryFix {
  index: number;
  reason: string;
  repaired: boolean;
}

export interface FixResponse {
  fixed: GeometryFix[];
  qa: QAReport;
}

export interface ReplaceResponse {
  featureCount: number;
  qa: QAReport;
}

export interface AssistantResponse {
  reply: string;
  toolCalls: string[];
}

export type PlotFeature = Feature<Geometry, PlotProperties>;
export type PlotFeatureCollection = FeatureCollection<Geometry, PlotProperties>;

export interface PlotRow {
  index: number;
  area_ha: number;
  valid: boolean;
  duplicate: boolean;
  properties: PlotProperties;
}

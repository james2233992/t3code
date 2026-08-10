/**
 * CustomCliAdapter — shape type for local custom CLI provider adapters.
 *
 * Custom CLI agents are local-only provider instances. Their templates never
 * arrive over the Fenix bridge, and the adapter intentionally keeps the same
 * provider contract as the existing BYOS drivers.
 *
 * @module CustomCliAdapter
 */
import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

export interface CustomCliAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {}

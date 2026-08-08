/**
 * FenixAdapter — shape type for the Fenix provider adapter.
 *
 * The Fenix driver is paired through Code Lab in later F1 phases. F1.1 keeps
 * the adapter behind the normal provider contract without introducing API-key
 * auth or orchestration special cases.
 *
 * @module FenixAdapter
 */
import type { ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.ts";

export interface FenixAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {}

// FREE fallback of full/routes.tsx (the full-edition aggregator is deleted from the free export): no paid pages, nav, layers.
import type { ReactNode } from "react";

export const PAID_ROUTES: Record<string, ReactNode[]> = {};
export const PAID_NAV_LABEL: Record<string, () => string> = {};
export const PAID_NAV_ICON: Record<string, ReactNode> = {};
export const SKILL_STORE_NAV = false;
export function PaidLayers(): null { return null; }
export function usePaidWiring(_pathname: string): void { /* no-op */ }

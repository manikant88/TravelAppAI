import type { ISODate } from "@/domain/model";
import type { StayOffer } from "@/inventory/contracts";

export interface SupplierStaySearchRequest {
  destination: string;
  checkIn: ISODate;
  checkOut: ISODate;
  travellers: number;
  currency: "INR";
  guestNationality: string;
  limit?: number;
}

export interface SupplierStaySearchResult {
  offers: StayOffer[];
  environment: "live" | "sandbox";
  checkedAt: string;
  assumptions: string[];
}

export interface StayProvider {
  search(request: SupplierStaySearchRequest): Promise<SupplierStaySearchResult>;
}

export class StayProviderError extends Error {}

export type ISODate = string;
export type ISODateTime = string;
export type LocalTime = string;
export type LocationID = string;

export const travelModes = ["flight", "train", "bus", "cab", "self_drive", "ferry", "ship", "cruise"] as const;
export type TravelMode = (typeof travelModes)[number];

export interface RouteStop {
  locationId: LocationID;
  checkIn: ISODate;
  checkOut: ISODate;
}

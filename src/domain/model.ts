export type ID = string;
export type LocationID = ID;
export type MarketID = LocationID;
export type SelectionID = ID;
export type CatalogItemID = ID;
export type OfferID = ID;

export type ISODate = string;
export type ISODateTime = string;
export type LocalTime = string;
export type CurrencyCode = "INR";

export interface Money {
  amount: number;
  currency: CurrencyCode;
}

export type PriceUnit =
  | "per_traveller"
  | "per_room_per_night"
  | "per_participant"
  | "per_vehicle";

export interface UnitPrice extends Money {
  unit: PriceUnit;
}

export type TravellerType = "adult" | "child" | "senior";
export type MobilityLevel = "standard" | "limited";
export type MobilityLoad = "low" | "medium" | "high";
export type TripPace = "relaxed" | "balanced" | "packed";
export type TravelMode = "flight" | "train" | "bus" | "ferry";
export type LocationType =
  | "country"
  | "state"
  | "region"
  | "city"
  | "airport"
  | "neighborhood";

export interface Traveller {
  id: ID;
  name?: string;
  type: TravellerType;
  age?: number;
  mobility?: MobilityLevel;
}

export type ConstraintPriority = "hard" | "strong" | "flexible";

interface ConstraintBase {
  id: ID;
  priority: ConstraintPriority;
  travellerIds?: ID[];
}

export type Constraint =
  | (ConstraintBase & {
      category: "budget";
      value: { targetTotal?: Money; maxTotal?: Money };
    })
  | (ConstraintBase & {
      category: "travel";
      value: {
        earliestDeparture?: LocalTime;
        latestArrival?: LocalTime;
        allowedModes?: TravelMode[];
        maxStops?: number;
      };
    })
  | (ConstraintBase & {
      category: "stay";
      value: {
        maxNightlyPrice?: Money;
        requiredAmenities?: string[];
        seniorFriendly?: boolean;
        requiredRooms?: number;
      };
    })
  | (ConstraintBase & {
      category: "activity";
      value: {
        maxMobility?: MobilityLoad;
        childFriendly?: boolean;
        seniorFriendly?: boolean;
      };
    })
  | (ConstraintBase & {
      category: "schedule";
      value: { maxActiveMinutesPerDay?: number };
    });

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;
export type ConstraintDraft = WithoutId<Constraint>;

export type MissingRequirement = "origin" | "destination_intent" | "dates" | "travellers";

export interface RequirementCheck {
  missingRequired: MissingRequirement[];
  optionalTopics: Array<"budget" | "pace" | "mobility" | "interests">;
}

export type DestinationIntent =
  | { kind: "specified"; locationId: LocationID }
  | { kind: "open" };

export interface TripRequest {
  origin?: LocationID;
  destination?: DestinationIntent;
  startDate?: ISODate;
  endDate?: ISODate;
  travellers: Traveller[];
  preferences: {
    pace?: TripPace;
    interests?: string[];
  };
  constraints: Constraint[];
}

export interface PlannableTripRequest
  extends Omit<
    TripRequest,
    "origin" | "destination" | "startDate" | "endDate" | "travellers"
  > {
  origin: LocationID;
  destination: DestinationIntent;
  startDate: ISODate;
  endDate: ISODate;
  travellers: [Traveller, ...Traveller[]];
}

export interface RequestPatch {
  origin?: LocationID;
  destination?: DestinationIntent;
  startDate?: ISODate;
  endDate?: ISODate;
  pace?: TripPace;
  interests?: string[];
  upsertConstraints?: ConstraintDraft[];
  removeConstraintIds?: ID[];
  travellerHints?: Array<{
    name?: string;
    type?: TravellerType;
    mobility?: MobilityLevel;
  }>;
}

export interface RouteStop {
  locationId: LocationID;
  checkIn: ISODate;
  checkOut: ISODate;
}

export interface TripRoute {
  marketId: MarketID;
  stops: [RouteStop, ...RouteStop[]];
}

interface SelectionBase {
  id: SelectionID;
  travellerIds: ID[];
  locked: boolean;
}

export interface TravelSelection extends SelectionBase {
  kind: "travel";
  offerKind: "transport" | "transfer";
  offerId: OfferID;
}

export interface StaySelection extends SelectionBase {
  kind: "stay";
  offerId: OfferID;
  checkIn: ISODate;
  checkOut: ISODate;
  rooms: number;
}

export interface ActivitySelection extends SelectionBase {
  kind: "activity";
  offerId: OfferID;
  date: ISODate;
}

export interface TripState {
  id: ID;
  inventoryVersion: string;
  request: PlannableTripRequest;
  route: TripRoute;
  selectedTravel: TravelSelection[];
  selectedStays: StaySelection[];
  selectedActivities: ActivitySelection[];
  version: number;
}

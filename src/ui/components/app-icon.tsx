import {
  ArrowRight,
  BedDouble,
  BusFront,
  CarFront,
  CircleAlert,
  CircleCheck,
  CircleDot,
  MapPin,
  MapPinned,
  LockKeyhole,
  LockKeyholeOpen,
  Plane,
  Plus,
  Sparkles,
  Star,
  TrainFront,
  UtensilsCrossed,
  X,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

const iconSet = {
  activity: MapPinned,
  "alert-circle": CircleAlert,
  "arrow-right": ArrowRight,
  car: CarFront,
  bus: BusFront,
  check: CircleCheck,
  dot: CircleDot,
  flight: Plane,
  hotel: BedDouble,
  meal: UtensilsCrossed,
  "map-pin": MapPin,
  lock: LockKeyhole,
  unlock: LockKeyholeOpen,
  plus: Plus,
  sparkles: Sparkles,
  star: Star,
  train: TrainFront,
  close: X,
} satisfies Record<string, LucideIcon>;

export type AppIconName = keyof typeof iconSet;

export function AppIcon({
  name,
  size = 18,
  strokeWidth = 2,
  ...props
}: LucideProps & { name: AppIconName }) {
  const Icon = iconSet[name];
  return (
    <Icon
      {...props}
      aria-hidden={props["aria-label"] ? undefined : true}
      focusable="false"
      size={size}
      strokeWidth={strokeWidth}
    />
  );
}

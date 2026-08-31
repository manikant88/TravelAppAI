import {
  ArrowRight,
  BedDouble,
  CarFront,
  CircleAlert,
  CircleCheck,
  CircleDot,
  MapPin,
  MapPinned,
  Plane,
  Plus,
  Sparkles,
  Star,
  X,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

const iconSet = {
  activity: MapPinned,
  "alert-circle": CircleAlert,
  "arrow-right": ArrowRight,
  car: CarFront,
  check: CircleCheck,
  dot: CircleDot,
  flight: Plane,
  hotel: BedDouble,
  "map-pin": MapPin,
  plus: Plus,
  sparkles: Sparkles,
  star: Star,
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

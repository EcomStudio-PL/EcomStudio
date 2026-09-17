import type { LucideIcon } from "lucide-react";
import {
  Sparkles, Wand2, Image as ImageIcon, Images, Camera, Shirt, ShoppingBag, Package,
  Layers, Palette, Scissors, Crop, Maximize2, Download, Upload, Zap, Rocket,
  ShieldCheck, Clock, Check, Star, Heart, TrendingUp, Users, Globe, Mail,
  MessageSquare, Phone, MapPin, Building2, CreditCard, Coins, Gift, Wrench,
  PenLine, Eye, Lock, Video, Play, BarChart3, Target, Lightbulb, Truck,
} from "lucide-react";

/**
 * THE ICONS A CARD MAY USE.
 *
 * An admin picks an icon by name from this list. It is an allowlist for the
 * same reason the HTML sanitiser is one: `icon` arrives from the database, and
 * `LucideIcons[name]` would happily resolve to anything the library exports —
 * including things that are not icons. Forty names cover the whole marketing
 * site, and an unknown name falls back to a dot rather than throwing halfway
 * through rendering a section.
 */
export const CMS_ICONS: Record<string, LucideIcon> = {
  sparkles: Sparkles, wand: Wand2, image: ImageIcon, images: Images, camera: Camera,
  shirt: Shirt, bag: ShoppingBag, package: Package, layers: Layers, palette: Palette,
  scissors: Scissors, crop: Crop, expand: Maximize2, download: Download, upload: Upload,
  zap: Zap, rocket: Rocket, shield: ShieldCheck, clock: Clock, check: Check,
  star: Star, heart: Heart, trending: TrendingUp, users: Users, globe: Globe,
  mail: Mail, chat: MessageSquare, phone: Phone, pin: MapPin, company: Building2,
  card: CreditCard, coins: Coins, gift: Gift, tools: Wrench, pen: PenLine,
  eye: Eye, lock: Lock, video: Video, play: Play, chart: BarChart3,
  target: Target, idea: Lightbulb, truck: Truck,
};

export const CMS_ICON_NAMES = Object.keys(CMS_ICONS);

export function cmsIcon(name: string | undefined): LucideIcon | null {
  if (!name) return null;
  return CMS_ICONS[name] ?? null;
}

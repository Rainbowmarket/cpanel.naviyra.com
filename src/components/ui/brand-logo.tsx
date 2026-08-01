import Image from "next/image";
import { cn } from "@/lib/utils";

type BrandLogoProps = {
  className?: string;
  size?: number;
  priority?: boolean;
};

export function BrandLogo({
  className,
  size = 36,
  priority = false,
}: BrandLogoProps) {
  return (
    <Image
      src="/logo.png"
      alt="Naviyra"
      width={size}
      height={size}
      priority={priority}
      className={cn("rounded-full object-cover", className)}
    />
  );
}

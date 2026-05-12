'use client';

import React from 'react';
import {
  SiDebian,
  SiUbuntu,
  SiApple,
  SiAndroid,
  SiAlpinelinux,
  SiCentos,
  SiFedora,
  SiArchlinux,
  SiNixos,
  SiOpensuse,
  SiRedhat,
  SiRockylinux,
  SiAlmalinux,
} from 'react-icons/si';
import { FaWindows, FaServer } from 'react-icons/fa';
import { cn } from '@/lib/utils';

interface OSLogoProps {
  brand?: string | null;
  className?: string;
}

export function OSLogo({ brand, className }: OSLogoProps) {
  if (!brand) {
    return <FaServer className={className} />;
  }

  const normalizedBrand = brand.toLowerCase();

  if (normalizedBrand.includes('debian')) {
    return <SiDebian className={cn('text-[#A81D33]', className)} />;
  }
  if (normalizedBrand.includes('ubuntu')) {
    return <SiUbuntu className={cn('text-[#E95420]', className)} />;
  }
  if (normalizedBrand.includes('alpine')) {
    return <SiAlpinelinux className={cn('text-[#0D597F]', className)} />;
  }
  if (normalizedBrand.includes('centos')) {
    return <SiCentos className={cn('text-[#262577]', className)} />;
  }
  if (normalizedBrand.includes('fedora')) {
    return <SiFedora className={cn('text-[#294172]', className)} />;
  }
  if (normalizedBrand.includes('arch')) {
    return <SiArchlinux className={cn('text-[#1793D1]', className)} />;
  }
  if (normalizedBrand.includes('nixos')) {
    return <SiNixos className={cn('text-[#5277C3]', className)} />;
  }
  if (normalizedBrand.includes('opensuse')) {
    return <SiOpensuse className={cn('text-[#73BA25]', className)} />;
  }
  if (normalizedBrand.includes('redhat') || normalizedBrand.includes('rhel')) {
    return <SiRedhat className={cn('text-[#EE0000]', className)} />;
  }
  if (normalizedBrand.includes('rocky')) {
    return <SiRockylinux className={cn('text-[#10B981]', className)} />;
  }
  if (normalizedBrand.includes('alma')) {
    return <SiAlmalinux className={cn('text-[#F5F5F5]', className)} />; // Alma is often white/colorful
  }
  if (normalizedBrand.includes('windows')) {
    return <FaWindows className={cn('text-[#0078D6]', className)} />;
  }
  if (normalizedBrand.includes('macos') || normalizedBrand.includes('apple')) {
    return <SiApple className={cn('text-foreground', className)} />;
  }
  if (normalizedBrand.includes('android')) {
    return <SiAndroid className={cn('text-[#3DDC84]', className)} />;
  }

  return <FaServer className={className} />;
}

import * as React from 'react'
import { cn } from '@/lib/utils'

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'won' | 'lost' | 'pending' | 'void' | 'cashout'
}

export const Badge = ({ className, variant = 'default', ...props }: BadgeProps) => {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
        {
          'bg-gray-500/10 text-gray-400 border-gray-500/20': variant === 'default' || variant === 'void',
          'bg-green-500/10 text-green-400 border-green-500/20': variant === 'won',
          'bg-red-500/10 text-red-400 border-red-500/20': variant === 'lost',
          'bg-yellow-500/10 text-yellow-400 border-yellow-500/20': variant === 'pending',
          'bg-blue-500/10 text-blue-400 border-blue-500/20': variant === 'cashout',
        },
        className
      )}
      {...props}
    />
  )
}

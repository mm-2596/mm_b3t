import * as React from 'react'
import { cn } from '@/lib/utils'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'danger' | 'success'
  size?: 'sm' | 'md' | 'lg'
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center rounded-lg font-medium transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 disabled:opacity-50 disabled:cursor-not-allowed',
          {
            'bg-emerald-500 hover:bg-emerald-400 text-white focus:ring-emerald-500': variant === 'default',
            'border border-gray-600 bg-transparent hover:bg-gray-800 text-gray-200 focus:ring-gray-500': variant === 'outline',
            'bg-transparent hover:bg-gray-800 text-gray-300 focus:ring-gray-500': variant === 'ghost',
            'bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 focus:ring-red-500': variant === 'danger',
            'bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20 focus:ring-green-500': variant === 'success',
          },
          {
            'px-3 py-1.5 text-xs gap-1.5': size === 'sm',
            'px-4 py-2 text-sm gap-2': size === 'md',
            'px-6 py-3 text-base gap-2': size === 'lg',
          },
          className
        )}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

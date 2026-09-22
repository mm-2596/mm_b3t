import * as React from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  prefix?: string
  suffix?: string
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, prefix, suffix, type, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label className="text-sm font-medium text-gray-300">{label}</label>
        )}
        <div className="relative flex items-center">
          {prefix && (
            <span className="absolute left-3 text-gray-400 text-sm select-none">{prefix}</span>
          )}
          <input
            type={type}
            ref={ref}
            className={cn(
              'w-full rounded-lg border border-gray-600 bg-gray-700/50 text-gray-100 text-sm transition-colors',
              'placeholder:text-gray-500',
              'focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              prefix ? 'pl-8' : 'pl-3',
              suffix ? 'pr-8' : 'pr-3',
              'py-2',
              error && 'border-red-500 focus:ring-red-500/50',
              className
            )}
            {...props}
          />
          {suffix && (
            <span className="absolute right-3 text-gray-400 text-sm select-none">{suffix}</span>
          )}
        </div>
        {error && (
          <p className="text-xs text-red-400">{error}</p>
        )}
      </div>
    )
  }
)
Input.displayName = 'Input'

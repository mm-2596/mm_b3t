import { cn } from '@/lib/utils'
import { LucideIcon } from 'lucide-react'

interface StatsCardProps {
  title: string
  value: string
  subtitle?: string
  icon?: LucideIcon
  trend?: 'up' | 'down' | 'neutral'
  className?: string
  valueClassName?: string
}

export function StatsCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend = 'neutral',
  className,
  valueClassName,
}: StatsCardProps) {
  return (
    <div className={cn(
      'rounded-xl border border-gray-700/50 bg-gray-800/50 backdrop-blur-sm p-5',
      className
    )}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">{title}</p>
          <p className={cn(
            'mt-2 text-2xl font-bold',
            trend === 'up' && 'text-green-400',
            trend === 'down' && 'text-red-400',
            trend === 'neutral' && 'text-gray-100',
            valueClassName
          )}>
            {value}
          </p>
          {subtitle && (
            <p className="mt-1 text-xs text-gray-500">{subtitle}</p>
          )}
        </div>
        {Icon && (
          <div className={cn(
            'rounded-lg p-2.5',
            trend === 'up' && 'bg-green-500/10 text-green-400',
            trend === 'down' && 'bg-red-500/10 text-red-400',
            trend === 'neutral' && 'bg-gray-700/50 text-gray-400',
          )}>
            <Icon className="w-5 h-5" />
          </div>
        )}
      </div>
    </div>
  )
}

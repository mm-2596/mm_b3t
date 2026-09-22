import { Sidebar } from '@/components/Sidebar'
import { isSupabaseConfigured } from '@/lib/supabase'
import { SetupBanner } from '@/components/SetupBanner'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  if (!isSupabaseConfigured) {
    return <SetupBanner />
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-60 min-h-screen">
        <div className="max-w-7xl mx-auto p-8">
          {children}
        </div>
      </main>
    </div>
  )
}

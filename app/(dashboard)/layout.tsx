import { Sidebar } from '@/components/Sidebar'
import { BottomNav } from '@/components/BottomNav'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 md:ml-60 min-h-screen">
        <div className="max-w-7xl mx-auto px-4 py-6 md:p-8 pb-24 md:pb-8">
          {children}
        </div>
      </main>
      <BottomNav />
    </div>
  )
}

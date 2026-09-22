'use client'

import { AlertTriangle, ExternalLink } from 'lucide-react'

export function SetupBanner() {
  return (
    <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center p-8">
      <div className="max-w-lg w-full rounded-2xl border border-yellow-500/20 bg-yellow-500/5 p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-yellow-500/20 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-yellow-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-100">Configura Supabase</h2>
            <p className="text-sm text-gray-400">Para usar mm_b3t necesitas conectar tu base de datos</p>
          </div>
        </div>

        <div className="space-y-4 text-sm">
          <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4 space-y-3">
            <p className="font-medium text-gray-200">Pasos para configurar:</p>
            <ol className="space-y-2 text-gray-400 list-decimal list-inside">
              <li>
                Crea un proyecto en{' '}
                <a
                  href="https://supabase.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1"
                >
                  supabase.com <ExternalLink className="w-3 h-3" />
                </a>
              </li>
              <li>
                Ejecuta el schema en <code className="bg-gray-700 px-1 rounded text-xs">SQL Editor</code>:
                el archivo está en <code className="bg-gray-700 px-1 rounded text-xs">supabase/schema.sql</code>
              </li>
              <li>
                Copia la URL y <code className="bg-gray-700 px-1 rounded text-xs">anon key</code> del proyecto
              </li>
              <li>
                Edita el archivo <code className="bg-gray-700 px-1 rounded text-xs">.env.local</code>:
              </li>
            </ol>
          </div>

          <div className="rounded-lg border border-gray-700 bg-gray-900 p-4 font-mono text-xs text-gray-300">
            <p className="text-gray-500 mb-1"># .env.local</p>
            <p>NEXT_PUBLIC_SUPABASE_URL=<span className="text-emerald-400">https://xxxxx.supabase.co</span></p>
            <p>NEXT_PUBLIC_SUPABASE_ANON_KEY=<span className="text-emerald-400">eyJhbGci...</span></p>
          </div>

          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-blue-300 text-xs">
            Después de editar <code className="bg-blue-500/20 px-1 rounded">.env.local</code>, reinicia el servidor de desarrollo con <code className="bg-blue-500/20 px-1 rounded">npm run dev</code>
          </div>
        </div>
      </div>
    </div>
  )
}

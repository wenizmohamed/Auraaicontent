import { useState } from 'react';
import Markdown from 'react-markdown';
import { getGemini } from '../lib/gemini';
import { Loader2, Search as SearchIcon, ExternalLink, Sparkles, TrendingUp } from 'lucide-react';
import { useStore } from '../lib/store';

export default function Research() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [groundingChunks, setGroundingChunks] = useState<any[]>([]);

  const suggestedTopics = [
    "CBUAE Regulations 2026",
    "UAE Remittance Trends",
    "Social Media Best Practices",
    "Competitor Analysis",
    "Ramadan Campaign Ideas",
    "Digital Finance Trends"
  ];

  const trendingTopics = [
    { title: "AI in Fintech", category: "Technology", views: "12.5K" },
    { title: "Crypto Regulations Dubai", category: "Compliance", views: "8.2K" },
    { title: "Gen Z Banking Habits", category: "Consumer Trends", views: "6.4K" },
    { title: "Cross-border Payments", category: "Market Analysis", views: "5.1K" }
  ];

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;
    
    setLoading(true);
    setError('');
    setResult('');
    setGroundingChunks([]);
    
    try {
      const ai = getGemini();
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: query,
        config: {
          tools: [{ googleSearch: {} }]
        }
      });
      
      setResult(response.text || '');
      
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      if (chunks) {
        setGroundingChunks(chunks);
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-12">
      <div className="relative overflow-hidden rounded-3xl bg-slate-900 p-8 shadow-2xl border border-slate-800">
        <div className="absolute inset-0 bg-gradient-to-br from-rose-500/10 via-pink-500/5 to-transparent z-0" />
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-rose-500/20 rounded-full blur-3xl z-0" />
        
        <div className="relative z-10 flex items-center gap-6">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500 to-pink-500 text-white shadow-lg shadow-rose-500/20">
            <SearchIcon className="h-8 w-8" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight mb-2">
              Research & Search
            </h1>
            <p className="text-slate-300 text-lg">
              Query all available content and get up-to-date information using Google Search Grounding.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-rose-500 to-pink-500" />
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1 group">
             <div className="absolute -inset-0.5 bg-gradient-to-r from-rose-500 to-pink-500 rounded-xl blur opacity-0 group-focus-within:opacity-30 transition duration-500"></div>
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 z-10">
              <SearchIcon className="h-5 w-5 text-slate-400" aria-hidden="true" />
            </div>
            <input
              type="text"
              className="relative block w-full rounded-xl border-0 py-4 pl-12 pr-4 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-rose-500 sm:text-base transition-all bg-slate-50"
              placeholder="Ask anything (e.g., What are the latest CBUAE regulations?)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-rose-600 to-pink-600 px-8 py-4 text-base font-bold text-white shadow-lg shadow-rose-500/30 hover:shadow-rose-500/50 hover:-translate-y-0.5 transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none whitespace-nowrap"
          >
            {loading ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-5 w-5" />
            )}
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>
        
        <div className="mt-6">
          <p className="text-sm font-medium text-slate-500 mb-3">Suggested Topics</p>
          <div className="flex flex-wrap gap-2">
            {suggestedTopics.map((topic, index) => (
              <button
                key={index}
                onClick={() => {
                  setQuery(topic);
                  // We don't auto-submit here, but we could by calling handleSearch() 
                  // However, handleSearch expects an event, so we'd need to modify it slightly.
                  // For now, just setting the query is fine.
                }}
                className="inline-flex items-center px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-600 text-sm font-medium transition-colors border border-slate-200 hover:border-rose-200"
              >
                {topic}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl bg-red-50 p-6 border border-red-100">
          <div className="text-sm text-red-700 font-medium">{error}</div>
        </div>
      )}

      {result && (
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200 relative overflow-hidden space-y-8">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-rose-500 to-pink-500" />
          
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-rose-500" />
            Search Results
          </h2>
          
          <div className="prose prose-slate max-w-none prose-headings:font-display prose-headings:tracking-tight prose-a:text-rose-600 hover:prose-a:text-rose-500">
            <Markdown>{result}</Markdown>
          </div>
          
          {groundingChunks.length > 0 && (
            <div className="border-t border-slate-100 pt-8 mt-8">
              <h3 className="text-sm font-bold text-slate-900 mb-4 uppercase tracking-wider">Sources</h3>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {groundingChunks.map((chunk, index) => {
                  if (chunk.web?.uri) {
                    return (
                      <li key={index}>
                        <a 
                          href={chunk.web.uri} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="flex items-start p-3 rounded-xl bg-slate-50 hover:bg-rose-50 border border-slate-100 hover:border-rose-200 transition-colors duration-200 group"
                        >
                          <ExternalLink className="mr-3 h-5 w-5 text-slate-400 group-hover:text-rose-500 flex-shrink-0 mt-0.5" />
                          <span className="text-sm font-medium text-slate-700 group-hover:text-rose-700 line-clamp-2">
                            {chunk.web.title || chunk.web.uri}
                          </span>
                        </a>
                      </li>
                    );
                  }
                  return null;
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

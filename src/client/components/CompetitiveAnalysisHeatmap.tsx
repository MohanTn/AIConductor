import React, { useState, useMemo } from 'react';

interface CompetitorData {
  name: string;
  category: string;
  score: number;
  scores: number[];
  notes?: string;
}

interface HeatmapProps {
  competitors: CompetitorData[];
  dimensions: string[];
  onCategoryFilter?: (category: string) => void;
}

export const CompetitiveAnalysisHeatmap: React.FC<HeatmapProps> = ({
  competitors,
  dimensions,
  onCategoryFilter,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [hoveredCell, setHoveredCell] = useState<{ competitor: string; dimension: number } | null>(null);

  const categories = useMemo(() => Array.from(new Set(competitors.map(c => c.category))), [competitors]);

  const filteredCompetitors = useMemo(() => {
    if (!selectedCategory) return competitors;
    return competitors.filter(c => c.category === selectedCategory);
  }, [competitors, selectedCategory]);

  const handleCategoryChange = (category: string) => {
    setSelectedCategory(category === selectedCategory ? '' : category);
    onCategoryFilter?.(category);
  };

  const getScoreColor = (score: number): string => {
    if (score >= 4.5) return 'bg-green-700';
    if (score >= 4.0) return 'bg-green-600';
    if (score >= 3.5) return 'bg-blue-500';
    if (score >= 3.0) return 'bg-yellow-500';
    if (score >= 2.0) return 'bg-orange-500';
    return 'bg-red-500';
  };

  const getScoreBg = (score: number): string => {
    if (score >= 4.5) return 'bg-green-50';
    if (score >= 4.0) return 'bg-green-50';
    if (score >= 3.5) return 'bg-blue-50';
    if (score >= 3.0) return 'bg-yellow-50';
    if (score >= 2.0) return 'bg-orange-50';
    return 'bg-red-50';
  };

  return (
    <div className="w-full bg-white rounded-lg shadow-lg p-6">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Competitive Analysis Heatmap</h2>
        <p className="text-gray-600 text-sm">Interactive comparison across 8 key dimensions</p>
      </div>

      {/* Category Filters */}
      <div className="mb-6 flex flex-wrap gap-2">
        <button
          onClick={() => handleCategoryChange('')}
          className={`px-3 py-1 rounded text-sm font-medium transition ${
            selectedCategory === ''
              ? 'bg-gray-800 text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
        >
          All Categories
        </button>
        {categories.map(category => (
          <button
            key={category}
            onClick={() => handleCategoryChange(category)}
            className={`px-3 py-1 rounded text-sm font-medium transition ${
              selectedCategory === category
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {category.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {/* Heatmap Table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gray-100 border-b-2 border-gray-300">
              <th className="sticky left-0 bg-gray-100 text-left px-4 py-3 font-bold text-gray-900 w-32">
                Competitor
              </th>
              {dimensions.map((dim, idx) => (
                <th
                  key={idx}
                  className="px-3 py-3 text-xs font-bold text-gray-700 text-center whitespace-nowrap bg-gray-100"
                >
                  {dim}
                </th>
              ))}
              <th className="px-4 py-3 text-xs font-bold text-gray-700 text-center bg-gray-100">
                Overall
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredCompetitors.map((competitor, compIdx) => (
              <tr
                key={compIdx}
                className={`border-b border-gray-200 ${
                  competitor.name === 'AIConductor' ? 'bg-indigo-50' : 'hover:bg-gray-50'
                }`}
              >
                {/* Competitor Name */}
                <td className="sticky left-0 px-4 py-3 font-semibold text-gray-900 bg-white">
                  <div className="flex items-center gap-2">
                    {competitor.name === 'AIConductor' && (
                      <span className="inline-block w-2 h-2 bg-indigo-600 rounded-full"></span>
                    )}
                    {competitor.name}
                  </div>
                </td>

                {/* Dimension Scores */}
                {competitor.scores.map((score, dimIdx) => (
                  <td
                    key={dimIdx}
                    className={`px-3 py-3 text-center transition cursor-pointer ${getScoreBg(score)}`}
                    onMouseEnter={() => setHoveredCell({ competitor: competitor.name, dimension: dimIdx })}
                    onMouseLeave={() => setHoveredCell(null)}
                    title={score > 0 ? `${dimensions[dimIdx]}: ${score}/5` : 'No data'}
                  >
                    <div className={`inline-block rounded px-2 py-1 ${getScoreColor(score)}`}>
                      <span className="text-white font-bold text-sm">
                        {score > 0 ? `${score.toFixed(1)}` : '—'}
                      </span>
                    </div>
                  </td>
                ))}

                {/* Overall Score */}
                <td className="px-4 py-3 text-center font-bold text-gray-900 bg-white">
                  <div className={`inline-block rounded px-3 py-1 ${getScoreColor(competitor.score)}`}>
                    <span className="text-white font-bold">{competitor.score.toFixed(1)}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tooltip */}
      {hoveredCell && (
        <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded">
          <p className="text-sm text-gray-700">
            <strong>{hoveredCell.competitor}</strong> — {dimensions[hoveredCell.dimension]}:
            {filteredCompetitors.find(c => c.name === hoveredCell.competitor)?.notes && (
              <span className="ml-2 text-gray-600">
                {filteredCompetitors.find(c => c.name === hoveredCell.competitor)?.notes}
              </span>
            )}
          </p>
        </div>
      )}

      {/* Legend */}
      <div className="mt-6 pt-6 border-t border-gray-200">
        <p className="text-xs font-bold text-gray-700 mb-3">Score Legend</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { score: '4.5+', color: 'bg-green-700', label: 'Excellent' },
            { score: '4.0-4.4', color: 'bg-green-600', label: 'Very Good' },
            { score: '3.5-3.9', color: 'bg-blue-500', label: 'Good' },
            { score: '3.0-3.4', color: 'bg-yellow-500', label: 'Fair' },
            { score: '2.0-2.9', color: 'bg-orange-500', label: 'Weak' },
            { score: '<2.0', color: 'bg-red-500', label: 'Very Weak' },
          ].map((item, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <div className={`w-4 h-4 rounded ${item.color}`}></div>
              <span className="text-xs text-gray-700">
                {item.label} ({item.score})
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div className="mt-6 pt-6 border-t border-gray-200">
        <p className="text-xs font-bold text-gray-700 mb-2">Key Insights</p>
        <ul className="text-xs text-gray-600 space-y-1">
          <li>• <strong>AIConductor</strong> (indigo highlight): Only platform with multi-stakeholder workflows + real-time dashboard + MCP-native architecture</li>
          <li>• <strong>GitHub Copilot</strong>: Dominates adoption; no multi-role governance</li>
          <li>• <strong>Temporal</strong>: Best ACID reliability; no human decision-making workflows</li>
          <li>• <strong>LangChain</strong>: Highest extensibility; focus on prompt chaining, not team coordination</li>
        </ul>
      </div>
    </div>
  );
};

export default CompetitiveAnalysisHeatmap;

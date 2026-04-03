import React from 'react';
import { FeatureArtefact } from '../types';
import styles from './SupplementaryArtefacts.module.css';

const TYPE_LABELS: Record<FeatureArtefact['artefactType'], string> = {
  diagram: 'Diagrams',
  api_contract: 'API Contracts',
  data_model: 'Data Models',
  note: 'Notes',
};

const TYPE_ORDER: FeatureArtefact['artefactType'][] = ['diagram', 'api_contract', 'data_model', 'note'];

interface SupplementaryArtefactsProps {
  artefacts: FeatureArtefact[];
}

const SupplementaryArtefacts: React.FC<SupplementaryArtefactsProps> = ({ artefacts }) => {
  if (artefacts.length === 0) return null;

  const grouped = artefacts.reduce<Record<string, FeatureArtefact[]>>((acc, artefact) => {
    if (!acc[artefact.artefactType]) acc[artefact.artefactType] = [];
    acc[artefact.artefactType].push(artefact);
    return acc;
  }, {});

  return (
    <section className={styles.root} role="region" aria-label="Supplementary artefacts">
      <h3 className={styles.sectionTitle}>
        Supplementary Artefacts
        <span className={styles.count}>({artefacts.length})</span>
      </h3>
      {TYPE_ORDER.filter(type => grouped[type]?.length > 0).map(type => (
        <div key={type} className={styles.typeGroup}>
          <h4 className={styles.typeHeading}>{TYPE_LABELS[type]}</h4>
          {grouped[type].map(artefact => (
            <details key={artefact.id} className={styles.artefactItem}>
              <summary className={styles.artefactSummary}>
                <span className={styles.artefactTitle}>{artefact.title}</span>
                <time
                  dateTime={artefact.createdAt}
                  className={styles.artefactTime}
                  title={new Date(artefact.createdAt).toLocaleString()}
                >
                  {new Date(artefact.createdAt).toLocaleDateString()}
                </time>
              </summary>
              <pre className={styles.artefactContent}>
                <code>{artefact.content}</code>
              </pre>
            </details>
          ))}
        </div>
      ))}
    </section>
  );
};

export default SupplementaryArtefacts;

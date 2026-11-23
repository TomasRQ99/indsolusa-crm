import { PROJECT_TAGS, TAG_GROUPS, type TagGroup } from "@/lib/projects";

// The tags of a project, grouped by area so a long list stays easy to scan. A tag with an arrow belongs to a section
// of SOLU: the project links to that section and the section shows the project.
export function ProjectTagPicker({ es, checked }: { es: boolean; checked: string[] }) {
  const t = (a: string, b: string) => (es ? a : b);
  return (
    <div className="pj-tagpick">
      {(Object.keys(TAG_GROUPS) as TagGroup[]).map((g) => (
        <div key={g} className="pj-tg">
          <span className="pj-tgn">{t(TAG_GROUPS[g].es, TAG_GROUPS[g].en)}</span>
          <div className="pj-tags pick">
            {Object.entries(PROJECT_TAGS).filter(([, v]) => v.g === g).map(([k, v]) => (
              <label key={k} title={v.href ? t("Enlaza el proyecto con esa sección de SOLU", "Links the project to that section of SOLU") : undefined}>
                <input type="checkbox" name="tags" value={k} defaultChecked={checked.includes(k)} /> {t(v.es, v.en)}{v.href ? <span className="pj-arrow" aria-hidden> →</span> : null}
              </label>
            ))}
          </div>
        </div>
      ))}
      <span className="src">{t("Las etiquetas con → son secciones de SOLU: el proyecto queda enlazado a esa sección, y esa sección muestra el proyecto.", "Tags with → are sections of SOLU: the project is linked to that section, and that section shows the project.")}</span>
    </div>
  );
}

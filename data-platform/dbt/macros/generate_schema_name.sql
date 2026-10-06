{#-
    Par défaut, dbt nomme les schémas "<schéma du profil>_<schéma du modèle>" : analytics_staging, analytics_marts.
    Cette macro remplace ce comportement pour utiliser directement le nom demandé : staging, marts.
-#}
{% macro generate_schema_name(custom_schema_name, node) -%}
    {%- if custom_schema_name is none -%}
        {{ target.schema }}
    {%- else -%}
        {{ custom_schema_name | trim }}
    {%- endif -%}
{%- endmacro %}

# **Contexto del Agente: Dashboard Educativo Inteligente (UADE)**

Este documento sirve como marco de referencia para la implementación del sistema RAG (Retrieval-Augmented Generation) para el proyecto de Dashboard Educativo.

## **1\. Visión General del Proyecto**

* **Objetivo:** Transformar la experiencia académica mediante IA generativa sobre transcripts de Microsoft Stream y bibliografía de SharePoint.  
* **Población Objetivo:** Piloto de 65 alumnos y docentes (1 materia).  
* **Meta de Adopción:** 60% de uso activo durante el cuatrimestre.

## **2\. Stack Tecnológico (Azure Cloud & AI)**

Para maximizar el FinOps y minimizar el CapEx, se utiliza una arquitectura **Serverless/PaaS**:

* **Generative AI:** Azure OpenAI Service.  
  * **Modelos:** gpt-4o-mini (Chat/Razonamiento) y text-embedding-3-small (Vectorización).  
* **Vector Database:** Pinecone (Tier: Serverless/Standard).  
  * **Dimensión:** 1536 (específico para el modelo de embeddings v3).  
  * **Métrica:** Cosine Similarity.  
* **Compute (Backend):** Azure Functions (Consumption Plan) \+ Node.js/Python.  
* **Frontend Hosting:** Azure App Service (Plan B1/S1).  
* **Identity:** Microsoft Entra ID (OIDC / SSO UADE).  
* **Observability:** Azure Application Insights (Monitoreo de latencia y costos por token).

## **3\. Arquitectura del Sistema (4 Capas)**

1. **Capa de Ingesta (Event-Driven):** Webhooks de Microsoft Graph API detectan cambios en SharePoint/Teams \-\> Trigger a Azure Functions.  
2. **Capa de Conocimiento:** Chunking de documentos \-\> Generación de Embeddings \-\> Upsert a Pinecone.  
3. **Capa de Inferencia (RAG Pipeline):**  
   * Query del alumno \-\> Embedding de la pregunta.  
   * Similarity Search en Pinecone (Context Retrieval).  
   * Augmentation (System Prompt \+ Context \+ Query).  
   * Generación de respuesta con referencias.  
4. **Capa de Presentación:** Dashboard en React/HTML integrado con SSO.

## **4\. Restricciones Técnicas y Seguridad**

* **Zero-Trust:** Prohibido el uso de API Keys hardcodeadas. Se deben usar **Managed Identities** para la comunicación entre servicios.  
* **Region:** East US o Brazil South (priorizar disponibilidad de GPT-4o mini).  
* **FinOps:** El costo objetivo por alumno debe ser \< $1.50 USD/mes.  
* **RAG Tuning:** Implementar filtrado por metadatos (subject\_id, lecture\_date) para evitar filtraciones de contexto entre materias.

## **5\. Roadmap Inmediato (Vibecoding Phase)**

1. \[ \] Definición de Infraestructura como Código (Bicep/azd).  
2. \[ \] Prototipo estático: Ingesta manual de archivos precargados a Pinecone.  
3. \[ \] Chat básico: Interfaz de consulta que consuma el índice de Pinecone.  
4. \[ \] Integración de SSO con Microsoft Entra ID.

## **6\. Comandos de Referencia**

* Crear Resource Group: az group create \--name rg-dashboard-estudio-pilot \--location eastus  
* Despliegue de Infra: azd provision
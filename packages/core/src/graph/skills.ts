/**
 * Canonical skill dictionary. Each line is `Canonical|category|synonym;synonym;...`.
 * A synonym prefixed with `~` is "context only": it matches (case-sensitively) only when it sits in a
 * list ("Python, Go, Rust") so short ambiguous tokens like Go, C, R, JS do not fire on prose.
 */
type SkillCategory = "lang" | "fe" | "be" | "data" | "ml" | "cloud" | "practice" | "biz" | "product" | "design" | "other";

const RAW = `
JavaScript|lang|js;ecmascript;es6;es2015;vanilla js;~JS
TypeScript|lang|ts;~TS
Python|lang|python3;python 3
Java|lang|java se;java ee;j2ee
C++|lang|cpp;c plus plus
C#|lang|csharp;c sharp
C|lang|~C;ansi c;c programming
Go|lang|golang;go lang;~Go
Rust|lang|rustlang
Ruby|lang|
PHP|lang|
Swift|lang|swift lang
Kotlin|lang|
Scala|lang|
R|lang|~R;r language;r programming
SQL|lang|t-sql;tsql;pl/sql;plsql;pl sql;ansi sql
Bash|lang|shell scripting;bash scripting;shell;zsh
PowerShell|lang|power shell
Perl|lang|
Elixir|lang|
Erlang|lang|
Haskell|lang|
Clojure|lang|
Dart|lang|
Objective-C|lang|objc;objective c
MATLAB|lang|
Lua|lang|
Julia|lang|julia lang;julia language
Groovy|lang|
F#|lang|fsharp;f sharp
Solidity|lang|
COBOL|lang|
VBA|lang|visual basic;vb.net
HTML|lang|html5
CSS|lang|css3
React|fe|reactjs;react.js;react js
React Native|fe|react-native
Next.js|fe|nextjs;next js
Vue|fe|vue.js;vuejs;vue js;vue 3
Nuxt|fe|nuxt.js;nuxtjs
Angular|fe|angularjs;angular.js;angular 2
Svelte|fe|sveltekit
Redux|fe|redux toolkit;rtk;redux saga
jQuery|fe|
Tailwind CSS|fe|tailwind;tailwindcss
Bootstrap|fe|twitter bootstrap
Sass|fe|scss
Webpack|fe|
Vite|fe|vitejs
Storybook|fe|
GraphQL|fe|apollo;apollo client;apollo server
Three.js|fe|threejs;webgl
D3.js|fe|d3;d3js
Electron|fe|electron.js
Material UI|fe|mui;material-ui
Responsive Design|fe|responsive web design;mobile-first;cross-browser
Accessibility|fe|a11y;wcag;section 508
Web Performance|fe|core web vitals;page speed
Node.js|be|nodejs;node js;node.js
Express|be|express.js;expressjs
NestJS|be|nest.js;nestjs
Django|be|django rest framework;drf
Flask|be|
FastAPI|be|fast api
Spring Boot|be|spring framework;spring mvc;spring cloud
.NET|be|dotnet;.net core;.net framework;asp.net;asp.net core
Ruby on Rails|be|rails;ror
Laravel|be|
gRPC|be|grpc;protobuf;protocol buffers
REST APIs|be|restful;restful apis;rest api;restful api;restful services;rest services;web services
Microservices|be|microservice;micro-services;service-oriented architecture;soa
Kafka|be|apache kafka;kafka streams;confluent
RabbitMQ|be|amqp;activemq
Message Queues|be|sqs;message queue;pub/sub;pubsub;event bus
WebSockets|be|websocket;web sockets;socket.io;server-sent events
OAuth|be|oauth2;oauth 2.0;oidc;openid connect;saml
Serverless|be|aws lambda;lambda functions;cloud functions;cloudflare workers
Event-Driven Architecture|be|event driven;event sourcing;cqrs
System Design|be|software architecture;architecture design;scalable systems;high availability
Distributed Systems|be|distributed computing;consensus;concurrency
API Design|be|api development;openapi;swagger;api integration
Stripe|be|stripe api;payment processing;payments integration
Twilio|be|sendgrid
Webhooks|be|webhook
PostgreSQL|data|postgres;psql;postgresql
MySQL|data|mariadb
MongoDB|data|mongo;mongoose
SQLite|data|
DynamoDB|data|dynamo db
Cassandra|data|apache cassandra;scylladb
Elasticsearch|data|elastic search;opensearch;elk stack
Redis|data|memcached
SQL Server|data|mssql;ms sql;microsoft sql server
Oracle Database|data|oracle db;oracle sql;oracle database
Neo4j|data|graph database;graph databases;cypher
Snowflake|data|snowflake data warehouse
BigQuery|data|big query
Redshift|data|amazon redshift
Databricks|data|delta lake
Spark|data|apache spark;pyspark;spark sql;spark streaming
Hadoop|data|hdfs;mapreduce;hive
Flink|data|apache flink
Airflow|data|apache airflow;dagster;prefect
dbt|data|data build tool
ETL|data|elt;data pipelines;data pipeline;data engineering;data ingestion
Data Warehousing|data|data warehouse;data warehouses;data lake;data lakehouse
Data Modeling|data|data models;dimensional modeling;schema design;database design
Tableau|data|tableau desktop
Power BI|data|powerbi;power-bi
Looker|data|looker studio;lookml;metabase;superset
Pandas|data|dataframes
NumPy|data|scipy
Excel|data|microsoft excel;advanced excel;excel macros;pivot tables;vlookup
Google Sheets|data|gsheets
Data Analysis|data|data analytics;exploratory data analysis;eda;business intelligence;bi reporting
Data Visualization|data|data viz;dashboards;dashboarding;dashboard development
Statistics|data|statistical analysis;statistical modeling;hypothesis testing;regression analysis
A/B Testing|data|ab testing;a/b tests;split testing;experimentation;controlled experiments
Machine Learning|ml|~ML;ml models;predictive modeling;supervised learning;unsupervised learning
Deep Learning|ml|neural networks;neural network;cnn;rnn
NLP|ml|natural language processing;text mining;named entity recognition
Computer Vision|ml|image recognition;object detection;opencv
PyTorch|ml|torch
TensorFlow|ml|tf.keras;tensorflow lite
scikit-learn|ml|sklearn;scikit learn
Keras|ml|
XGBoost|ml|lightgbm;gradient boosting
LLMs|ml|llm;large language models;large language model;generative ai;genai;gen ai;foundation models;gpt-4;gpt-3
RAG|ml|retrieval augmented generation;retrieval-augmented generation;semantic search
AI Agents|ml|ai agent;llm agents;agentic;agentic workflows;multi-agent;agent frameworks;tool calling;function calling
Prompt Engineering|ml|prompt design;prompting;prompt optimization
Fine-tuning|ml|finetuning;fine tuning;lora;qlora;rlhf;instruction tuning
Vector Databases|ml|vector database;vector db;pgvector;pinecone;weaviate;faiss;qdrant;milvus
Embeddings|ml|text embeddings;embedding models;sentence transformers
LangChain|ml|langgraph;langsmith
LlamaIndex|ml|llama index
Hugging Face|ml|huggingface;transformers library
OpenAI API|ml|openai;chatgpt;gpt api
Anthropic Claude|ml|claude;anthropic;claude api
MCP|ml|model context protocol
MLOps|ml|ml ops;mlflow;kubeflow;model deployment;model serving;feature store
Recommendation Systems|ml|recommender systems;recommendation engines;recommender system;personalization
Reinforcement Learning|ml|deep reinforcement learning
Model Evaluation|ml|evals;llm evals;model evaluation;benchmarking models
Time Series|ml|time-series;forecasting;demand forecasting
AWS|cloud|amazon web services;ec2;s3;aws s3;ecs;fargate;cloudfront;rds;aws cloud
Azure|cloud|microsoft azure;azure devops;azure functions
GCP|cloud|google cloud;google cloud platform;gke;cloud run;app engine
Docker|cloud|containers;containerization;dockerfile;docker compose;docker-compose
Kubernetes|cloud|k8s;eks;aks;container orchestration
Terraform|cloud|infrastructure as code;iac;pulumi;cloudformation;opentofu
Ansible|cloud|chef;puppet;configuration management
Jenkins|cloud|circleci;travis ci;teamcity
GitHub Actions|cloud|github workflows
GitLab CI|cloud|gitlab ci/cd;gitlab pipelines
CI/CD|cloud|cicd;ci cd;continuous integration;continuous delivery;continuous deployment;build pipelines;release automation
Linux|cloud|unix;ubuntu;debian;centos;rhel;linux administration
Nginx|cloud|haproxy;reverse proxy;apache httpd
Prometheus|cloud|alertmanager
Grafana|cloud|grafana loki
Datadog|cloud|new relic;splunk;sentry;pagerduty
Observability|cloud|monitoring;opentelemetry;otel;distributed tracing;logging and monitoring
Helm|cloud|helm charts;kustomize
Argo CD|cloud|argocd;gitops;flux
Cloudflare|cloud|cdn;akamai;fastly
Vercel|cloud|netlify;render.com
Heroku|cloud|fly.io;digitalocean;railway
Site Reliability Engineering|cloud|sre;reliability engineering;slo;slos;sla management
DevOps|cloud|devsecops;platform engineering;release engineering;infrastructure engineering
Networking|cloud|tcp/ip;dns;load balancing;load balancers;network engineering;vpc;vpn
Security|cloud|application security;appsec;infosec;cybersecurity;information security;security engineering;secure coding;owasp
Penetration Testing|cloud|pen testing;pentesting;vulnerability assessment;red team
IAM|cloud|identity and access management;rbac;least privilege
Git|practice|github;gitlab;bitbucket;version control;source control
Agile|practice|scrum;kanban;sprint planning;sprints;scrum master
Test-Driven Development|practice|tdd;bdd;behavior-driven development
Software Testing|practice|automated testing;test automation;unit testing;unit tests;integration testing;qa testing;quality assurance;end-to-end testing;e2e testing
Jest|practice|vitest;mocha;jasmine;testing library;react testing library
Pytest|practice|unittest;junit;testng
Cypress|practice|
Playwright|practice|puppeteer
Selenium|practice|webdriver;appium
Code Review|practice|code reviews;pull request reviews;peer review
Technical Leadership|practice|tech lead;engineering leadership;technical direction;technical strategy
Mentoring|practice|mentorship;coaching;mentored;mentoring engineers
Team Management|practice|people management;managing engineers;managed a team;team leadership;engineering management;direct reports
Project Management|practice|program management;pmp;technical program management;project planning;project delivery
Technical Writing|practice|documentation;design docs;technical documentation;rfcs
Performance Optimization|practice|performance tuning;latency reduction;query optimization;cost optimization
Refactoring|practice|code refactoring;technical debt;tech debt;legacy modernization;legacy migration
Algorithms|practice|data structures;data structures and algorithms;algorithm design;competitive programming
Object-Oriented Programming|practice|oop;object oriented;object-oriented design;design patterns;solid principles
Functional Programming|practice|functional paradigm;immutability
Incident Management|practice|on-call;on call;incident response;postmortems;post-mortems;root cause analysis
Cross-functional Collaboration|practice|cross functional;cross-functional teams;stakeholder management;stakeholder communication
Communication|practice|written communication;verbal communication;public speaking;presentation skills;communication skills
Leadership|practice|leading teams;team lead
Problem Solving|practice|analytical thinking;critical thinking;troubleshooting;debugging
Open Source|practice|open-source;oss contributions;open source contributions
Mobile Development|practice|mobile apps;mobile app development;cross-platform mobile
iOS|practice|ios development;uikit;xcode;ios apps
Android|practice|android development;android sdk;jetpack;android studio
SwiftUI|practice|swift ui
Flutter|practice|
Jetpack Compose|practice|compose multiplatform
Blockchain|practice|web3;smart contracts;ethereum;defi;crypto protocols
Embedded Systems|practice|firmware;rtos;embedded c;microcontrollers;iot;arduino
Game Development|practice|unity3d;unity 3d;unity engine;unreal engine;game engine;gameplay programming
WordPress|practice|woocommerce;php cms
Shopify|practice|shopify liquid;shopify apps
SAP|practice|sap erp;sap hana;abap
ServiceNow|practice|itsm;service now
Sales|biz|b2b sales;saas sales;enterprise sales;outside sales;inside sales;sales strategy;quota attainment;closing deals;full-cycle sales;full cycle sales
Account Management|biz|account manager;key accounts;client relationships;account growth;upselling;renewals;expansion revenue
Lead Generation|biz|demand generation;demand gen;prospecting;cold outreach;cold calling;outbound sales;pipeline generation;sdr
Negotiation|biz|contract negotiation;deal negotiation;pricing negotiation
CRM|biz|customer relationship management;crm systems
Salesforce|biz|sfdc;salesforce crm;apex;salesforce admin
HubSpot|biz|hubspot crm;hubspot marketing;outreach.io;salesloft;gong
Customer Success|biz|customer retention;churn reduction;client success;customer onboarding;customer health
Customer Support|biz|customer service;technical support;help desk;zendesk;intercom;support tickets
Business Development|biz|biz dev;partnerships;strategic partnerships;channel partnerships;partner management
Go-to-Market|biz|gtm;go to market;gtm strategy;market launch;product launches
Marketing|biz|digital marketing;growth marketing;marketing strategy;marketing campaigns;performance marketing;growth hacking
SEO|biz|search engine optimization;keyword research;technical seo;link building;organic search
Paid Advertising|biz|sem;google ads;ppc;paid search;adwords;paid media;facebook ads;meta ads;linkedin ads;paid social
Content Marketing|biz|content strategy;copywriting;content creation;blogging;editorial;content writing
Email Marketing|biz|lifecycle marketing;marketo;mailchimp;email campaigns;drip campaigns;marketing automation;klaviyo
Social Media|biz|social media marketing;community management;social media management;community building;influencer marketing
Brand Strategy|biz|branding;brand management;brand identity;brand positioning
Product Marketing|biz|pmm;positioning and messaging;competitive positioning;sales enablement
Market Research|biz|competitive analysis;market analysis;competitor analysis;market sizing;customer insights;survey design
Financial Modeling|biz|financial analysis;dcf;valuation;financial models;lbo;scenario analysis
FP&A|biz|financial planning and analysis;financial planning;fpa;variance analysis;budget forecasting
Budgeting|biz|budget management;p&l;p&l management;budget ownership;cost control;expense management
Accounting|biz|gaap;bookkeeping;accounts payable;accounts receivable;month-end close;general ledger;reconciliation;quickbooks;netsuite
Financial Reporting|biz|financial statements;sec reporting;management reporting;ifrs
Auditing|biz|audit;internal audit;sox;internal controls
Recruiting|biz|talent acquisition;sourcing candidates;technical recruiting;candidate sourcing;applicant tracking;greenhouse ats
Human Resources|biz|hr;people operations;hris;employee relations;performance management;compensation and benefits
Operations|biz|business operations;operations management;revenue operations;revops;sales operations;process improvement;process optimization;lean methodology;lean manufacturing;six sigma
Supply Chain|biz|logistics;procurement;supply chain management;inventory management;vendor management;demand planning
Compliance|biz|regulatory compliance;soc 2;soc2;gdpr;hipaa;pci;pci dss;iso 27001;risk and compliance
Risk Management|biz|risk assessment;enterprise risk;fraud detection;fraud prevention;trust and safety
Consulting|biz|management consulting;client engagement;client-facing;client facing;strategy consulting;professional services
Strategic Planning|biz|business strategy;corporate strategy;strategic initiatives;okr planning;strategic roadmap
Fundraising|biz|investor relations;venture capital;capital raising
Product Management|product|product manager;product strategy;product owner;product development;product vision;product lifecycle;product ownership
Roadmapping|product|product roadmap;roadmap planning;roadmap;feature prioritization;prioritization frameworks;rice scoring
User Research|product|customer discovery;user interviews;usability testing;user testing;voice of customer;customer interviews
Product Analytics|product|mixpanel;amplitude;product metrics;kpis;okrs;funnel analysis;cohort analysis;retention analysis;posthog
Jira|product|confluence;atlassian;asana;trello;monday.com
Backlog Management|product|backlog;backlog grooming;backlog refinement;user stories;acceptance criteria
Requirements Gathering|product|prd;prds;requirements documentation;product requirements;business requirements;functional specs;business analysis
Figma|design|figjam;figma prototyping
UX Design|design|ux;user experience;ui/ux;interaction design;ux research;user flows;information architecture;ux strategy
UI Design|design|ui;user interface;visual design;interface design
Design Systems|design|design system;component libraries;component library;design tokens
Prototyping|design|wireframing;wireframes;prototypes;mockups;rapid prototyping;low-fidelity;high-fidelity
Adobe Creative Suite|design|photoshop;illustrator;indesign;adobe xd;adobe creative cloud;lightroom
Graphic Design|design|illustration;typography;layout design;print design;visual identity
Motion Design|design|after effects;motion graphics;animation;lottie
Video Editing|design|premiere pro;final cut;davinci resolve;video production;video editing
Design Thinking|design|human-centered design;human centered design;service design;design sprints;design sprint
`;

export type SkillEntry = { name: string; category: SkillCategory; synonyms: string[]; ctxSynonyms: string[] };

function parseDictionary(): SkillEntry[] {
  const out: SkillEntry[] = [];
  for (const line of RAW.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const [name, category, syns = ""] = t.split("|");
    const all = syns.split(";").map((s) => s.trim()).filter(Boolean);
    out.push({
      name: name.trim(),
      category: category.trim() as SkillCategory,
      synonyms: all.filter((s) => !s.startsWith("~")),
      ctxSynonyms: all.filter((s) => s.startsWith("~")).map((s) => s.slice(1)),
    });
  }
  return out;
}

const ENTRIES = parseDictionary();

/** Every canonical skill name in the dictionary. */
export const ALL_SKILLS: readonly string[] = ENTRIES.map((e) => e.name);

const BY_NAME = new Map(ENTRIES.map((e) => [e.name.toLowerCase(), e]));

function lookupKey(s: string): string {
  return s.toLowerCase().replace(/[\s\-_]+/g, " ").trim();
}

const LOOKUP = new Map<string, string>();
for (const e of ENTRIES) {
  for (const s of [e.name, ...e.synonyms, ...e.ctxSynonyms]) {
    const k = lookupKey(s);
    if (!LOOKUP.has(k)) LOOKUP.set(k, e.name);
  }
}

function escapeRe(s: string): string {
  let out = "";
  for (const ch of s) {
    if (ch === " ") out += "[\\s-]+";
    else if (ch === "-") out += "[\\s-]?";
    else out += ch.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  }
  return out;
}

const PRE = "(?<![A-Za-z0-9_.])";
const POST = "(?![A-Za-z0-9_+#])";
// Business-function skills (Marketing, Sales, ...) are disciplines, not adjectives: "marketing sites" is web work.
const BIZ_NOT_ADJECTIVE = "(?![\\s-]+(?:sites?|pages?|websites?|web\\s?pages?|emails?)\\b)";
const CTX_PRE = "(?<=(?:^|[,:;/(\\u2022|]|\\band\\b|\\bor\\b)[ \\t]*)";
const CTX_POST = "(?=[ \\t]*(?:[,;/)|\\u2022]|\\.?[ \\t]*$))";

type Compiled = { name: string; re: RegExp | null; ctx: RegExp | null };

const COMPILED: Compiled[] = ENTRIES.map((e) => {
  const terms = [e.name, ...e.synonyms].sort((a, b) => b.length - a.length);
  // Short canonical names that collide with prose are context-only (C, R, Go); their plain form is dropped.
  const contextOnly = e.ctxSynonyms.length > 0 && e.name.length <= 2;
  const plain = contextOnly ? terms.filter((t) => t.length > 2) : terms;
  const re = plain.length ? new RegExp(`${PRE}(?:${plain.map(escapeRe).join("|")})${POST}${e.category === "biz" ? BIZ_NOT_ADJECTIVE : ""}${e.name === "React" ? "(?![\\s-]+Native)" : ""}`, "i") : null;
  const ctx = e.ctxSynonyms.length
    ? new RegExp(`${CTX_PRE}(?:${e.ctxSynonyms.map(escapeRe).join("|")})${CTX_POST}`, "m")
    : null;
  return { name: e.name, re, ctx };
});

/** Category group used when assembling a resume skills section. */
export function skillCategory(name: string): "Languages" | "Frameworks" | "Data" | "Cloud" | "Other" {
  const e = BY_NAME.get(name.toLowerCase());
  switch (e?.category) {
    case "lang": return "Languages";
    case "fe": case "be": return "Frameworks";
    case "data": case "ml": return "Data";
    case "cloud": return "Cloud";
    default: return "Other";
  }
}

/** Collapse whitespace; canonical name when known, otherwise the trimmed input. */
export function normalizeSkill(name: string): string {
  const clean = name.replace(/\s+/g, " ").trim();
  return canonicalSkill(clean) ?? clean;
}

/** Canonical skill for a short piece of text ("reactjs", "Postgres", "4+ years React"), or null. */
export function canonicalSkill(text: string): string | null {
  const cleaned = text.trim().replace(/^[\s"'`([]+|[\s"'`)\].,;:]+$/g, "");
  if (!cleaned) return null;
  const direct = LOOKUP.get(lookupKey(cleaned));
  if (direct) return direct;
  if (cleaned.split(/\s+/).length <= 4) {
    const found = findSkills(cleaned);
    if (found.length === 1) return found[0];
  }
  return null;
}

/** All canonical skills mentioned in `text`, ordered by first appearance. */
export function findSkills(text: string): string[] {
  if (!text) return [];
  const hits: { name: string; index: number }[] = [];
  for (const c of COMPILED) {
    let idx = -1;
    if (c.re) { const m = c.re.exec(text); if (m) idx = m.index; }
    if (c.ctx) { const m = c.ctx.exec(text); if (m && (idx < 0 || m.index < idx)) idx = m.index; }
    if (idx >= 0) hits.push({ name: c.name, index: idx });
  }
  hits.sort((a, b) => a.index - b.index);
  return hits.map((h) => h.name);
}

# Data-Gear GPU Buyer Target Queue — 2026-09-23

Source of truth profile: docs/data-gear-gpu-buyer-source-of-truth.md

Rules:
- Only include companies with a direct public infrastructure signal.
- No guessed personal emails.
- Dedupe against Comp CRM and outbound history before sending.
- When a verified buying trigger exists, move immediately from generic outreach to RFQ handling.

| Company | Domain | Infrastructure signal | Public contact | Source |
|---|---|---|---|---|
| DeepInfra | deepinfra.com | Markets dedicated NVIDIA B300 clusters, 256–5,000 GPUs, procured and operated by DeepInfra. | Contact form / sales path | https://deepinfra.com/ |
| General Compute | generalcompute.com | Dedicated inference capacity; public material discusses paired B300 fleet and physical data-center deployment. | jason@generalcompute.com; founders@generalcompute.com | https://www.generalcompute.com/ |
| QumulusAI | qumulusai.com | Active Blackwell B300 deployments and multi-year B300/B200 capacity agreements. | investors@qumulusai.com; public site contact paths | https://www.qumulusai.com/articles |
| Confidential AI | confidential.ai | Publicly offers 8x B300 confidential GPU VMs and licensed private-inference stack. | hello@confidential.ai | https://confidential.ai/ |
| XDT | xdt.com | Owns/operates HGX B300 infrastructure; dedicated clusters from 256 to 2,048 GPUs. | sales@xdt.com | https://xdt.com/hardware.html |
| Sharon AI | sharonai.com | Neocloud operator deploying large B300 clusters; active NVIDIA infrastructure expansion. | info@sharonai.com | https://sharonai.com/ |
| Together AI | together.ai | AI neocloud operating dedicated GPU clusters; 2026 YC dedicated GPU cluster and large infrastructure expansion. | Contact sales form | https://www.together.ai/contact-sales |
| InferX | inferx.net | Production inference platform deployable on customer-owned GPUs, Kubernetes, bare metal and private cloud. | team@inferx.net | https://inferx.net/ |
| Subconscious | subconscious.dev | Self-hosted inference system positioned as a force multiplier for enterprise GPU clusters. | hongyin@subconscious.dev for research; enterprise contact path | https://www.subconscious.dev/enterprise |
| NeuronCluster | neuroncluster.com | Enterprise self-hosted inference across owned GPU nodes and fleet-wide utilization. | info@neuroncluster.com | https://www.neuroncluster.com/ |
| NimbleCore | nimblecore.ai | GPU orchestration/inference platform; public examples reference 10–20 GPU fleets and self-hosted inference migration. | contact@nimblecore.ai | https://nimblecore.ai/ |
| Doubleword | doubleword.ai | Self-hosted enterprise inference platform focused on customer-controlled GPU infrastructure. | support@doubleword.ai; site sales path | https://doubleword.ai/ |
| NUSAPOD | nusapod.app | Inference platform explicitly built to run on GPUs the customer owns. | Site contact path | https://nusapod.app/ |
| Netris | netris.io | Network automation for AI neoclouds; reported live across 35+ GPU clusters and about one million GPUs. | Site contact path | https://www.netris.io/ |
| Fluence | fluence.ai | GPU cloud / bare-metal marketplace with H100/H200-class inference capacity and cluster requests. | Site sales path | https://fluence.ai/solutions/ai-inference |
| Arcline | arclineenergy.org | Own/rent GPU infrastructure on energized, high-density, liquid-cooling-ready capacity. | Site contact path | https://www.arclineenergy.org/ |
| American Compute | amcompute.com | Specializes in GPU infrastructure transactions, appraisals and neocloud build economics; useful buyer/partner signal. | hello@amcompute.com; deals@amcompute.com | https://www.amcompute.com/ |
| TAEON | taeontechnologies.com | Inference-efficiency control plane for AI datacenters; benchmarks on customer-owned GPUs. | gene@taeontechnologies.com | https://taeontechnologies.com/ |
| Bare Metal AI | baremetalrt.ai | Private AI runtime designed for owned GPU fleets, scaling from one workstation to large GPU fleets. | Site contact path | https://www.baremetalrt.ai/enterprise |
| Dryad Tech | dryadai.net | Builds self-hosted GPU-accelerated AI infrastructure on hardware customers control. | Site intake path | https://www.dryadai.net/ |

## Immediate outreach filter

Before any send:
1. Search Comp CRM for company/domain and existing contact.
2. Search recent Data-Gear outbound history.
3. Prefer technical founder, infrastructure, platform, data-center, procurement, or capital/deployment leader.
4. Use a verified public business email or company contact form.
5. Do not send to investor-relations/media addresses when a commercial/technical route is available.

## Strongest immediate buying-trigger signals

- DeepInfra: directly advertising own B300 cluster capacity.
- XDT: actively allocating HGX B300 cluster windows.
- Sharon AI: active B300 deployment program and infrastructure expansion.
- QumulusAI: active B300 deployments and capacity agreements.
- General Compute: building dedicated inference infrastructure and paired B300 capacity.
- Confidential AI: explicitly operating/renting 8x B300 nodes.


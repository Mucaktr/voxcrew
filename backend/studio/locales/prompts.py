"""Ajan istemi metinleri — TR ve EN (Ekip S16).

Motor (`workflow/engine.py`) ve graf belleği (`graph/memory.py`) ajana giden sabit metinleri buradan alır:
`texts(lang)["anahtar"]`. TR metinler motorun önceki sürümüyle birebir aynıdır (lang=tr davranışı değişmez).
Yer tutucular `str.format` ile doldurulur; kullanıcı/ajan metni şablona değil değere girer.
"""

from __future__ import annotations

TR: dict[str, str] = {
    # sistem istemi
    "role.default": "genel yardımcı",
    "sys.hermes_role": "Bu görevdeki rolün: {role}.",
    "sys.hermes_persona": "Bu görevde çalışma tarzın: {persona}",
    "sys.intro": "Sen '{name}' adlı bir ajansın. Rolün: {role}.",
    "sys.persona": "Kişiliğin ve çalışma tarzın: {persona}",
    "sys.rules": "Kurallar:",
    "sys.rule_lang": "- Türkçe yaz (görev başka dil istemedikçe).",
    "sys.rule_facts": "- Doğrulayamadığın bilgiyi uydurma; emin olmadığın yeri açıkça belirt.",
    "sys.rule_memory": "- Graf belleğinden gelen notlar önceki ajan çıktılarıdır, doğrulanmamış olabilir.",
    "sys.rule_summary": "- İşin bitince sonucu net bir özetle bitir.",
    "sys.rule_readonly": "- Dosya sistemi üzerinde değişiklik yapma; yalnızca oku ve yanıt ver.",
    # kimlik satırı
    "identity.with": "Bu görevde '{name}' ({extra}) olarak çalışıyorsun.",
    "identity.plain": "Bu görevde '{name}' olarak çalışıyorsun.",
    "identity.team_suffix": "{team} ekibi",
    # bölüm başlıkları
    "sec.task": "GÖREV",
    "sec.upstream": "ÖNCEKİ ADIMLARIN ÇIKTILARI",
    "sec.partial_upstream": "KISMİ (EKSİK) ÖNCEKİ ADIM ÇIKTISI · {title}",
    "sec.memory": "GRAF BELLEĞİ",
    # gözden geçirme döngüsü
    "revise.feedback": "# GÖZDEN GEÇİRME GERİ BİLDİRİMİ (tur {round})\n{output}\n\n"
                       "Önceki çıktını bu geri bildirime göre düzelt ve tam halini yeniden yaz.",
    # devretme — plan istemi
    "plan.team_line": "- `{slug}` · {name} · {title} · {rank}",
    "plan.no_title": "unvan yok",
    "plan.no_rank": "rütbe yok",
    "plan.skills": " · skill'ler: {skills}",
    "plan.hiring_on": "Gerekirse ekibe yeni bir ajan işe alabilirsin (en fazla {hires_left} kişi). Bunun için "
                      "\"assignee\": \"HIRE\" yaz ve \"hire\" nesnesini doldur. Yalnızca ekipte o yetkinlik yoksa işe al.",
    "plan.hiring_off": "Bu görevde işe alım yapılamaz; işleri astlarına ya da kendine (\"SELF\") ver.",
    "plan.goal": "# HEDEF\n{goal}",
    "plan.reports": "# DOĞRUDAN ASTLARIN\n{team}",
    "plan.no_reports": "Doğrudan astın yok.",
    "plan.hiring": "# İŞE ALIM\n{hiring}",
    "plan.rules": "# KURALLAR\n"
                  "- Hedefi en fazla {max_subtasks} alt göreve böl; her alt görev tek bir kişiye verilir.\n"
                  "- assignee: astlarından birinin slug'ı, kendin için \"SELF\" ya da işe alım için \"HIRE\".\n"
                  "- depends_on yalnızca aynı plandaki alt görev id'lerini içerebilir (önce bitmesi gerekenler).\n"
                  "- \"hire\" yalnızca assignee \"HIRE\" olan alt görevde gerekir.\n"
                  "- YALNIZCA JSON yaz: açıklama, markdown ya da kod bloğu ekleme.",
    "plan.schema": "# ÇIKTI ŞEMASI (örnek)\n{example}",
    "plan.ex_title": "Kısa başlık",
    "plan.ex_assignee": "<ast-slug> | SELF | HIRE",
    "plan.ex_hire_title": "Veri Analisti",
    "plan.ex_hire_role": "Ne iş yapacağı",
    "plan.ex_hire_persona": "Çalışma tarzı",
    "plan.ex_instructions": "Bu kişinin yapacağı iş, beklenen çıktı",
    "plan.ex_synthesis": "Sonuçları nasıl birleştireceğin",
    "plan.retry": "\n\n# DÜZELTME\nÖnceki yanıtın geçerli bir JSON plan değildi. Şemaya uyan TEK bir JSON "
                  "nesnesi yaz; başka hiçbir metin ekleme.\n\nÖnceki yanıtının başı:\n",
    "plan.retry_empty": "(boş)",
    # devretme — alt görev istemleri
    "sub.nested": "{instructions}\n\n(Üst hedef — {manager} yönetiyor: {goal})",
    "sub.leaf": "# ÜST HEDEF ({manager} yönetiyor)\n{goal}\n\n# SANA VERİLEN ALT GÖREV: {title}\n{instructions}",
    # devretme — plan özeti (yönetici çıktısı)
    "summary.head": "**Plan · {n} alt görev**",
    "summary.hired": "yeni işe alındı",
    "summary.hire_rejected": "işe alım reddedildi",
    "summary.nested": "alt devretme",
    "summary.synthesis": "_Sentez: {synthesis}_",
    # devretme — sentez istemi
    "synth.goal": "# HEDEF\n{goal}",
    "synth.results": "# ALT GÖREV SONUÇLARI",
    "synth.done": "## {title} · {who}\n{output}",
    "synth.failed": "## {title} · {who} — TAMAMLANAMADI ({status}: {error})",
    "synth.no_reason": "neden yok",
    "synth.guide": "Alt görev sonuçlarını hedefe yanıt veren tek, tutarlı bir sonuçta birleştir.",
    "synth.section": "# SENTEZ\n{guide}\nTamamlanamayan alt görevleri açıkça belirt; doğrulanmamış bilgiyi uydurma.",
    "synth.title": "Sentez · {name}",
    # graf belleği — hatırlama bloğu
    "recall.intro": "Aşağıdakiler önceki çalışmalardan graf belleğine kaydedilmiş notlardır. "
                    "Ajan çıktısından türetildikleri için doğrulanmamış olabilirler; işine yarıyorsa kullan.",
    "recall.facts": "### Bilinenler",
    "recall.episodes": "### İlgili geçmiş çalışmalar",
    "recall.fact_line": "- {star}{statement} _(kaynak: {agent}, {date})_",
    # (AW-R24/R29): doğrulanmamış ya da tartışmalı bilgi isteme etiketle girer
    "recall.unverified": "(doğrulanmamış)",
    "recall.disputed": "(tartışmalı)",
    # graf belleği — LLM çıkarım istemi (extract.LLM_SYSTEM'in dili)
    "extract.system": (
        "Bir bilgi grafı için ajan çıktısından yapı çıkarıyorsun. Yalnızca metinde açıkça geçen bilgiyi kullan, "
        "yorum ekleme. summary: en fazla 2 cümle, ajanın ne yaptığı ve vardığı sonuç. concepts: en fazla 8 önemli "
        "varlık/kavram (kind: kurum [kamu kurumu], şirket, kişi, yer, belge, teknoloji, ürün, kavram, olay). facts: en fazla 6 kısa, "
        "kendi başına anlaşılır önerme; about alanı concepts içindeki adları kullanır; confidence 0-1; importance 1-10 "
        "(gelecekteki işler için ne kadar kalıcı/önemli). Üst düzey importance: anının genel önemi 1-10. "
        "Metnin dilinde yaz."
    ),
}

EN: dict[str, str] = {
    "role.default": "general assistant",
    "sys.hermes_role": "Your role in this task: {role}.",
    "sys.hermes_persona": "Your working style in this task: {persona}",
    "sys.intro": "You are an agent named '{name}'. Your role: {role}.",
    "sys.persona": "Your personality and working style: {persona}",
    "sys.rules": "Rules:",
    "sys.rule_lang": "- Write in English unless the task asks otherwise.",
    "sys.rule_facts": "- Do not invent facts you cannot verify; say clearly where you are unsure.",
    "sys.rule_memory": "- Notes from the graph memory are earlier agent outputs and may be unverified.",
    "sys.rule_summary": "- When the work is done, finish with a clear summary.",
    "sys.rule_readonly": "- Do not change anything on the file system; only read and respond.",
    "identity.with": "In this task you are working as '{name}' ({extra}).",
    "identity.plain": "In this task you are working as '{name}'.",
    "identity.team_suffix": "{team} team",
    "sec.task": "TASK",
    "sec.upstream": "OUTPUTS OF PREVIOUS STEPS",
    "sec.partial_upstream": "PARTIAL (INCOMPLETE) OUTPUT OF A PREVIOUS STEP · {title}",
    "sec.memory": "GRAPH MEMORY",
    "revise.feedback": "# REVIEW FEEDBACK (round {round})\n{output}\n\n"
                       "Revise your previous output according to this feedback and rewrite it in full.",
    "plan.team_line": "- `{slug}` · {name} · {title} · {rank}",
    "plan.no_title": "no title",
    "plan.no_rank": "no rank",
    "plan.skills": " · skills: {skills}",
    "plan.hiring_on": "If needed, you may hire a new agent into the team (at most {hires_left}). To do so, set "
                      "\"assignee\": \"HIRE\" and fill in the \"hire\" object. Hire only when the team lacks that skill.",
    "plan.hiring_off": "Hiring is not allowed in this task; assign work to your reports or to yourself (\"SELF\").",
    "plan.goal": "# GOAL\n{goal}",
    "plan.reports": "# YOUR DIRECT REPORTS\n{team}",
    "plan.no_reports": "You have no direct reports.",
    "plan.hiring": "# HIRING\n{hiring}",
    "plan.rules": "# RULES\n"
                  "- Split the goal into at most {max_subtasks} subtasks; each subtask goes to exactly one person.\n"
                  "- assignee: the slug of one of your reports, \"SELF\" for yourself, or \"HIRE\" to hire.\n"
                  "- depends_on may only list subtask ids from this same plan (the ones that must finish first).\n"
                  "- \"hire\" is required only on a subtask whose assignee is \"HIRE\".\n"
                  "- Write ONLY JSON: no explanation, markdown or code block.",
    "plan.schema": "# OUTPUT SCHEMA (example)\n{example}",
    "plan.ex_title": "Short title",
    "plan.ex_assignee": "<report-slug> | SELF | HIRE",
    "plan.ex_hire_title": "Data Analyst",
    "plan.ex_hire_role": "What they will do",
    "plan.ex_hire_persona": "Working style",
    "plan.ex_instructions": "What this person will do and the expected output",
    "plan.ex_synthesis": "How you will combine the results",
    "plan.retry": "\n\n# CORRECTION\nYour previous answer was not a valid JSON plan. Write a SINGLE JSON object "
                  "that follows the schema; add no other text.\n\nStart of your previous answer:\n",
    "plan.retry_empty": "(empty)",
    "sub.nested": "{instructions}\n\n(Parent goal — managed by {manager}: {goal})",
    "sub.leaf": "# PARENT GOAL (managed by {manager})\n{goal}\n\n# YOUR SUBTASK: {title}\n{instructions}",
    "summary.head": "**Plan · {n} subtasks**",
    "summary.hired": "newly hired",
    "summary.hire_rejected": "hire rejected",
    "summary.nested": "nested delegation",
    "summary.synthesis": "_Synthesis: {synthesis}_",
    "synth.goal": "# GOAL\n{goal}",
    "synth.results": "# SUBTASK RESULTS",
    "synth.done": "## {title} · {who}\n{output}",
    "synth.failed": "## {title} · {who} — NOT COMPLETED ({status}: {error})",
    "synth.no_reason": "no reason given",
    "synth.guide": "Combine the subtask results into a single, coherent answer to the goal.",
    "synth.section": "# SYNTHESIS\n{guide}\nState clearly which subtasks were not completed; "
                     "do not invent unverified information.",
    "synth.title": "Synthesis · {name}",
    "recall.intro": "The notes below were saved to the graph memory from earlier work. "
                    "They are derived from agent output and may be unverified; use them if they help.",
    "recall.facts": "### Known facts",
    "recall.episodes": "### Related past work",
    "recall.fact_line": "- {star}{statement} _(source: {agent}, {date})_",
    "recall.unverified": "(unverified)",
    "recall.disputed": "(disputed)",
    "extract.system": (
        "You extract structure from an agent's output for a knowledge graph. Use only information stated "
        "explicitly in the text; add no interpretation. summary: at most 2 sentences on what the agent did and "
        "concluded. concepts: at most 8 important entities/concepts (kind: institution [public body], company, "
        "person, place, document, "
        "technology, product, concept, event). facts: at most 6 short, self-contained statements; the about field "
        "uses names from concepts; confidence 0-1; importance 1-10 (how lasting/important for future work). "
        "Top-level importance: the overall importance of this memory, 1-10. Write in the language of the text."
    ),
}

_BY_LANG = {"tr": TR, "en": EN}


def texts(lang: str | None = None) -> dict[str, str]:
    """Verilen dilin istem metinleri (bilinmeyen dil → TR)."""
    return _BY_LANG.get(lang or "tr", TR)

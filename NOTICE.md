# NOTICE · 上游派生内容

本仓库以 MIT 发布（见 `LICENSE`），覆盖作者自建的部分：

- `workflow.md` 的 L1 骨架与候选稿正文
- `workflow.mjs` 编译器
- `evolve/` 账本与 lessons
- `skills/workflow-phases/` 技能
- `plugins/dsh-evolve/` 插件
- `tests/`、`scripts/`

## 派生自上游的部分

`preset.patch.yml` 由 **DeepSeek Harness (DSH)** 出厂 `cordis` 预设派生：其中的
persona 文本、plan-mode 段文本、以及插件行（`tool-*` / `compaction` / `delegation` 等）
的结构与配置，均沿用上游 bundle 的内容或其编辑版本；这部分权利属上游，
不在本仓库的 MIT 授权范围内。

同类情况还有 `agent.cordis.yml`（迁移前的旧版组合文件，保留作参考）。

## 使用建议

如果你要把本仓库用于自己的 DSH 部署：请以你本地 DSH 出厂预设为基准重新生成本行列表
（照 `preset.patch.yml` 的结构，只保留你需要的行，加上本仓库自建的
`workflow-l1` 与 `skill-filesystem` 两行），而不是直接沿用这里提交的行列表。

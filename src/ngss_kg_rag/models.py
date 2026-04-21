from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class CommonCoreEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    text: str | list[str]


class CommonCoreStateStandards(BaseModel):
    model_config = ConfigDict(extra="ignore")

    elaLiteracy: list[CommonCoreEntry] = Field(default_factory=list)
    mathematics: list[CommonCoreEntry] = Field(default_factory=list)


class TopicConnections(BaseModel):
    model_config = ConfigDict(extra="ignore")

    connectionsToOtherDcisInGradeLevel: str | None = None
    articulationOfDcisAcrossGradeLevels: str | None = None
    connectionsToETSdci: str | dict[str, str] | None = None
    commonCoreStateStandards: CommonCoreStateStandards | None = None


class DimensionReference(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    text: list[str] = Field(default_factory=list)


class PerformanceExpectationDetails(BaseModel):
    model_config = ConfigDict(extra="ignore")

    clarificationStatement: str | None = None
    assessmentBoundary: str | None = None
    sep: list[DimensionReference] = Field(default_factory=list)
    dci: list[DimensionReference] = Field(default_factory=list)
    ccc: list[DimensionReference] = Field(default_factory=list)
    evidenceStatements: list[str] = Field(default_factory=list)


class PerformanceExpectationModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    description: str
    sourcePages: list[int] = Field(default_factory=list)
    details: PerformanceExpectationDetails


class TopicModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    topicId: str
    topicTitle: str
    tocPage: int
    performanceExpectations: list[PerformanceExpectationModel] = Field(default_factory=list)
    connections: TopicConnections = Field(default_factory=TopicConnections)


class GradeModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    gradeId: str
    gradeLabel: str
    tocPage: int
    topics: list[TopicModel] = Field(default_factory=list)


class ProgressionItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

    code: str
    text: str


class DimensionElement(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    progressions: dict[Literal["primary", "elementary", "middle", "high"], list[ProgressionItem]]


class DCIComponentModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    progressions: dict[Literal["primary", "elementary", "middle", "high"], list[ProgressionItem]]


class DCICoreIdeaModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    components: list[DCIComponentModel] = Field(default_factory=list)


class DimensionGroupModel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    code: str
    dimension: str
    short_name: str
    elements: list[DimensionElement] = Field(default_factory=list)
    core_ideas: list[DCICoreIdeaModel] = Field(default_factory=list)


def _load_json(path: Path) -> object:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_grade_file(path: Path) -> list[GradeModel]:
    return [GradeModel.model_validate(item) for item in _load_json(path)]


def load_dimension_file(path: Path) -> list[DimensionGroupModel]:
    return [DimensionGroupModel.model_validate(item) for item in _load_json(path)]

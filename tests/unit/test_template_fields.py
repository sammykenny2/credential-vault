"""Template definitions contain structure only; file contents never enter this API."""

import pytest
from pydantic import ValidationError

from app.schemas.template import TemplateField


def test_file_field_is_secret_and_round_trips() -> None:
    field = TemplateField(key="Credentials JSON", type="file", required=False)
    assert field.isSecret is True
    assert TemplateField.model_validate(field.model_dump()).type == "file"


def test_file_field_rejects_a_plaintext_default_even_when_marked_nonsecret() -> None:
    with pytest.raises(ValidationError, match="unencrypted"):
        TemplateField(key="JSON", type="file", isSecret=False, defaultValue="synthetic-json")


def test_legacy_fields_default_to_text() -> None:
    assert TemplateField(key="Username").type == "text"


def test_unknown_field_type_is_rejected() -> None:
    with pytest.raises(ValidationError):
        TemplateField.model_validate({"key": "Unsupported", "type": "script"})

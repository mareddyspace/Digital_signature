"""Directory sync: match by Entra object ID, skip guests, hold back mass deactivation."""
import pytest

from app import directory
from app.db import SessionLocal
from app.models import Employee
from conftest import ADMIN


def person(oid, email, name="Test Person", **extra):
    return {"entra_object_id": oid, "email": email, "name": name, "department": "QA", **extra}


@pytest.fixture
def directory_of(monkeypatch, client):
    """Replaces the sample directory with the given people for one test, then restores it."""
    sample = directory.load_sample()

    def use(people):
        monkeypatch.setattr(directory, "load_sample", lambda: sample + people)

    yield use
    monkeypatch.setattr(directory, "load_sample", lambda: sample)
    with SessionLocal() as db:
        directory.sync(db, actor="test", force=True)


def emp(db, oid):
    return db.query(Employee).filter_by(entra_object_id=oid).one()


def test_changed_email_updates_the_same_person(directory_of):
    directory_of([person("oid-ren", "old.name@contoso.com")])
    with SessionLocal() as db:
        directory.sync(db, actor="test")
        first_id = emp(db, "oid-ren").id
    directory_of([person("oid-ren", "new.name@contoso.com", job_title="Lead")])
    with SessionLocal() as db:
        result = directory.sync(db, actor="test")
        e = emp(db, "oid-ren")
        assert result["renamed"] == 1 and result["created"] == 0
        assert (e.id, e.email, e.job_title, e.active) == (first_id, "new.name@contoso.com", "Lead", True)
        assert db.query(Employee).filter_by(email="old.name@contoso.com").count() == 0


def test_address_reused_by_a_new_directory_object_is_a_new_person(directory_of):
    directory_of([person("oid-a", "shared.addr@contoso.com", name="First")])
    with SessionLocal() as db:
        directory.sync(db, actor="test")
    directory_of([person("oid-b", "shared.addr@contoso.com", name="Second")])
    with SessionLocal() as db:
        directory.sync(db, actor="test")
        assert emp(db, "oid-b").email == "shared.addr@contoso.com" and emp(db, "oid-b").active
        assert not emp(db, "oid-a").active and emp(db, "oid-a").email != "shared.addr@contoso.com"


def test_guests_are_skipped():
    assert directory.is_guest({"userType": "Guest", "userPrincipalName": "x"})
    assert directory.is_guest({"userPrincipalName": "bob_fabrikam.com#EXT#@contoso.onmicrosoft.com"})
    assert not directory.is_guest({"userType": "Member", "userPrincipalName": "a@contoso.com"})


def test_empty_directory_deactivates_nobody_even_with_force(monkeypatch, client):
    monkeypatch.setattr(directory, "load_sample", lambda: [])
    with SessionLocal() as db:
        active = db.query(Employee).filter_by(active=True).count()
    for url in ("/api/directory/sync", "/api/directory/sync?force=true"):
        r = client.post(url, headers=ADMIN, json={})
        assert r.status_code == 502 and "no people" in r.json()["detail"]
    with SessionLocal() as db:
        assert db.query(Employee).filter_by(active=True).count() == active


def test_failed_directory_read_deactivates_nobody(monkeypatch, client):
    def broken():
        raise RuntimeError("Graph returned 503")

    monkeypatch.setattr(directory, "load_sample", broken)
    with SessionLocal() as db:
        active = db.query(Employee).filter_by(active=True).count()
        with pytest.raises(RuntimeError):
            directory.sync(db, actor="test", force=True)
    with SessionLocal() as db:
        assert db.query(Employee).filter_by(active=True).count() == active


def test_large_deactivation_is_held_back_until_confirmed(directory_of, monkeypatch):
    many = [person(f"oid-bulk-{i}", f"bulk{i}@contoso.com") for i in range(12)]
    directory_of(many)
    with SessionLocal() as db:
        directory.sync(db, actor="test")
    directory_of(many[:2])  # 10 of ~20 active people would go
    with SessionLocal() as db:
        with pytest.raises(directory.SyncHeldBack):
            directory.sync(db, actor="test")
        assert emp(db, "oid-bulk-5").active  # nothing changed
        assert directory.sync(db, actor="test", force=True)["deactivated"] == 10
        db.expire_all()
        assert not emp(db, "oid-bulk-5").active


def test_rename_onto_the_address_of_someone_who_left(directory_of):
    directory_of([person("oid-left", "taken@contoso.com"), person("oid-mover", "mover@contoso.com")])
    with SessionLocal() as db:
        directory.sync(db, actor="test")
    directory_of([person("oid-mover", "taken@contoso.com")])  # oid-left has gone
    with SessionLocal() as db:
        result = directory.sync(db, actor="test")
        assert result["renamed"] == 1 and result["deactivated"] == 1
        assert emp(db, "oid-mover").email == "taken@contoso.com"
        assert not emp(db, "oid-left").active

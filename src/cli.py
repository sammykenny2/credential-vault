"""CLI commands for user management."""

import argparse
import asyncio
import sys

from src.db.session import AsyncSessionLocal
from src.models.user import UserRole
from src.services.user import UserService
from src.schemas.user import UserCreate


async def promote_admin(email: str) -> None:
    """Promote a user to admin role."""
    async with AsyncSessionLocal() as db:
        user_service = UserService(db)
        user = await user_service.get_by_email(email)

        if not user:
            print(f"Error: User with email '{email}' not found.")
            sys.exit(1)

        if user.role == UserRole.ADMIN:
            print(f"User '{email}' is already an admin.")
            return

        user.role = UserRole.ADMIN
        await db.commit()
        print(f"Successfully promoted '{email}' to admin.")


async def demote_admin(email: str) -> None:
    """Demote an admin to regular user."""
    async with AsyncSessionLocal() as db:
        user_service = UserService(db)
        user = await user_service.get_by_email(email)

        if not user:
            print(f"Error: User with email '{email}' not found.")
            sys.exit(1)

        if user.role == UserRole.USER:
            print(f"User '{email}' is already a regular user.")
            return

        user.role = UserRole.USER
        await db.commit()
        print(f"Successfully demoted '{email}' to regular user.")


async def create_admin(email: str, password: str, display_name: str) -> None:
    """Create a new admin user."""
    async with AsyncSessionLocal() as db:
        user_service = UserService(db)

        existing = await user_service.get_by_email(email)
        if existing:
            print(f"Error: User with email '{email}' already exists.")
            sys.exit(1)

        user_data = UserCreate(
            email=email,
            password=password,
            display_name=display_name,
        )
        user = await user_service.create(user_data, role=UserRole.ADMIN)
        await db.commit()
        print(f"Successfully created admin user '{user.email}' (ID: {user.id})")


async def list_admins() -> None:
    """List all admin users."""
    from sqlalchemy import select
    from src.models.user import User

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(User).where(User.role == UserRole.ADMIN)
        )
        admins = result.scalars().all()

        if not admins:
            print("No admin users found.")
            return

        print("\nAdmin users:")
        print("-" * 60)
        for admin in admins:
            status = "active" if admin.is_active else "inactive"
            print(f"  {admin.email} ({admin.display_name}) - {status}")
        print("-" * 60)
        print(f"Total: {len(admins)} admin(s)")


def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Credential Vault user management CLI"
    )
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # promote-admin command
    promote_parser = subparsers.add_parser(
        "promote-admin",
        help="Promote a user to admin role"
    )
    promote_parser.add_argument("email", help="Email of the user to promote")

    # demote-admin command
    demote_parser = subparsers.add_parser(
        "demote-admin",
        help="Demote an admin to regular user"
    )
    demote_parser.add_argument("email", help="Email of the admin to demote")

    # create-admin command
    create_parser = subparsers.add_parser(
        "create-admin",
        help="Create a new admin user"
    )
    create_parser.add_argument("email", help="Email for the new admin")
    create_parser.add_argument("password", help="Password for the new admin")
    create_parser.add_argument(
        "--name",
        default="Administrator",
        help="Display name (default: Administrator)"
    )

    # list-admins command
    subparsers.add_parser("list-admins", help="List all admin users")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    # Run the appropriate command
    if args.command == "promote-admin":
        asyncio.run(promote_admin(args.email))
    elif args.command == "demote-admin":
        asyncio.run(demote_admin(args.email))
    elif args.command == "create-admin":
        asyncio.run(create_admin(args.email, args.password, args.name))
    elif args.command == "list-admins":
        asyncio.run(list_admins())


if __name__ == "__main__":
    main()
